# pi-session-recap 架构设计（v0.2.0）

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

### 2.1 100% 前缀同构的 Prompt Cache 复用

**不改 system prompt，不改 tools 定义，不破坏消息历史序列**，在对话末尾仅追加一条纯文本引导消息：

```
主会话 Request Payload：
  [system_prompt + active_tools] + [compaction_summary] + [turns 0..N]

Recap side-query Request Payload：
  [system_prompt + active_tools] + [compaction_summary] + [turns 0..N] + [tail_user_prompt]

→ System Prompt 完全同构 ✅
→ Active Tools 列表与 Schema 完全同构（杜绝 API 400 校验错误）✅
→ Compaction Summary 与前序 Turns 序列完全同构 ✅
→ 仅末尾追加 100 字纯文本总结引导（Tail Guidance）✅
→ 前 95%+ Token 序列 100% 命中前缀缓存（Anthropic/OpenAI/Gemini/DeepSeek）✅
```

对比传统实现：
- 传统实现若将历史压缩为纯文本 `<conversation>` 字符串塞进单个新消息，会完全破坏 Provider 侧自第 0 个 token 起算的 KV Cache 前缀，导致 100% 缓存未命中（Cache Miss）；
- 若请求遗漏主会话 tools 声明，不仅可能引起 API 校验报错，亦会打乱工具定义在 System Block 中的缓存块。

### 2.2 上下文与工具对齐

- **System Prompt**：直接取 `ctx.getSystemPrompt()`；
- **Tools 列表**：取 `pi.getAllTools()` 中命中 `pi.getActiveTools()` 的激活工具集合，保持 Schema 逐字段同构；
- **消息序列**：取 `ctx.sessionManager.buildSessionProjection().messages` 并经 `convertToLlm()` 映射（天然包含 compaction summary 标记）；
- **Tail Guidance**：末尾单次追加引导词（明确要求直接纯文本回复、不调用任何工具、不超过 100 字）。

### 2.3 Side-query 隔离

- 独立 `sessionId`（`uuidv7()`），`cacheRetention: "none"`；
- 结果仅通过 `ctx.ui.notify()` 展示，**不写入对话历史**，不产生任何上下文污染；
- `maxTokens: 300`，限制成本；
- 显式 `AbortSignal.timeout(45000)` 超时防护，杜绝网络悬挂。

### 2.4 多模型逐级容灾降级（Cascade Fallback）

候选队列：`[ google/gemini-2.5-flash, openai/gpt-4.1-mini, anthropic/claude-3-5-haiku-20241022, ctx.model ]`。
1. 过滤未认证项并按 `provider/id` 严格去重；
2. 优先请求轻量模型（快、省），若遇到 429、网络瞬断、超时或 API 报错，**自动无缝降级尝试下一个候选模型**；
3. 全部轻量模型故障时，由当前会话模型（`ctx.model`）进行最后重试兜底；
4. 失败时精确直显错误详情，拒绝模糊覆盖；自动触发失败后延后 10 分钟重试（退避机制）。

---

## 3. 触发方式

### 3.1 手动：`/recap` 命令

用户随时输入 `/recap`，立即生成并展示。

### 3.2 自动：会话持续很久后

- 时机：`session_start` 记录 `lastRecapAt`；每次 `turn_end` 检查 `now - lastRecapAt >= autoRecapIntervalMinutes`（默认 **50 分钟**）；
- 满足条件且会话已有消息时，生成一次 recap，随后重置计时（仅历史为空的刚进入会话状态跳过——recap 在其余任何时候都支持）；
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
