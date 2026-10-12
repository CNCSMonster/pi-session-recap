# pi-session-recap 架构设计（v0.1.0）

## 1. 问题

用户在长对话中工作一段时间后离开或继续，需要快速回忆：

- 这个对话在做什么？
- 完成了什么？
- 还在做什么？
- 最后几轮在干嘛？

现有的 compaction summary 是给**模型**看的（为了继续对话而压缩），不是给**用户**看的。用户需要一个面向自己的"回忆辅助"（recap）。

### Recap 与 Summary 的边界

| | Summary（compaction） | Recap（本扩展） |
|---|---|---|
| 给谁看 | 模型（让对话能继续） | 用户（帮用户回忆） |
| 目的 | 节省 token | 快速唤醒上下文记忆 |
| 生成时机 | 上下文快满时 | 用户手动 / 会话持续很久后 |
| 存储 | 写入对话历史 | **不写入历史**，瞬时 side-query |

recap **基于** summary（compaction 后的对话上下文天然包含 summary），而非替代 summary。

---

## 2. 核心设计

### 2.1 复用 Prompt Cache 的 side-query

**不改 system prompt**，在对话末尾追加一条引导消息：

```
主对话 cache key：
  system_prompt + history[0..N]

Recap side-query cache key：
  system_prompt + history[0..N] + user_message("请用 2-3 句话总结...")

→ system prompt 相同 ✅
→ 对话历史相同 ✅
→ 仅末尾新增一条引导 ✅
→ 前缀可复用 prompt cache ✅
```

对比 qwen-code `/recap`：其使用专用短 system prompt + 只取最后 30 条消息，cache 完全不同且长对话中会丢失"大目标"上下文。

### 2.2 取完整分支上下文

`ctx.sessionManager.getBranch()` → `convertToLlm()` → `serializeConversation()`。

- 对话经历过 compaction 时，分支中天然含 summary 条目，recap 直接基于它生成；
- 不截断为"最后 30 条"，避免长会话丢失早期关键信息。

### 2.3 Side-query 隔离

- 独立 `sessionId`（`uuidv7()`），`cacheRetention: "none"`；
- 结果仅通过 `ctx.ui.notify()` 展示，**不写入对话历史**，不产生任何上下文污染；
- `maxTokens: 300`，限制成本。

### 2.4 模型选择

按优先级回退：`google/gemini-2.5-flash` → `openai/gpt-4.1-mini` → `anthropic/claude-3-5-haiku-20241022`。
选择第一个已配置认证的可用模型（轻量、便宜、快）。

---

## 3. 触发方式

### 3.1 手动：`/recap` 命令

用户随时输入 `/recap`，立即生成并展示。

### 3.2 自动：会话持续很久后

- 时机：`session_start` 记录 `lastRecapAt`；每次 `turn_end` 检查 `now - lastRecapAt >= autoRecapIntervalMinutes`（默认 **50 分钟**）；
- 满足条件且对话至少 3 条消息时，生成一次 recap，随后重置计时；
- `recapInProgress` 互斥标志防止手动/自动并发重复触发；
- 可通过配置关闭（`autoRecap: false`）。

> 设计取舍：触发依据是"会话持续时间"而非"窗口离开/回来"——用户明确不需要 away-recap，需要的是"对话经过很长时间、上下文可能开始被遗忘时"的提醒。

---

## 4. 配置

配置文件两层合并，**项目优先**：

| 层 | 路径 |
|---|---|
| 全局 | `~/.pi/agent/extensions/session-recap.json` |
| 项目 | `<cwd>/.pi/session-recap.json` |

```json
{
  "autoRecap": true,
  "autoRecapIntervalMinutes": 50
}
```

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `autoRecap` | boolean | `true` | 是否启用自动 recap |
| `autoRecapIntervalMinutes` | number | `50` | 自动 recap 触发间隔（分钟，正整数） |

容错：非法 JSON 与非法字段值均回落到默认值，不抛错（`normalizeConfig`）。

---

## 5. 模块划分

```
extensions/
├── config.ts          # 配置加载与合并（纯 Node，仅 node:fs / node:path，可独立测试）
├── session-recap.ts   # 扩展主体：/recap 命令 + session_start / turn_end 事件
tests/
└── config.test.ts     # node --test --experimental-strip-types，6 用例
```

依赖约束：

- `config.ts` 零 Pi 运行时依赖 → 测试毫秒级、无外部依赖；
- `session-recap.ts` 只依赖 peer：`@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent`。

---

## 6. 生命周期

| 事件 | 行为 |
|---|---|
| `session_start` | 加载配置文件、初始化 `lastRecapAt`、复位互斥标志 |
| `/recap` 命令 | 手动触发 side-query → notify 展示 |
| `turn_end` | 自动 recap 条件检查（配置开关 + 间隔 + 最小消息数） |
| `session_shutdown` | 无需清理（全部为内存态） |

状态均为会话内存态，不持久化，重启自然复位。
