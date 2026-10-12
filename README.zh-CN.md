# pi-session-recap

[English](./README.md) | **简体中文** | [用户手册](./docs/user-guide.zh-CN.md) | [架构设计](./docs/architecture-spec.md)

[Pi Coding Agent](https://github.com/earendil-works/pi) 的会话回忆扩展——输入 `/recap`（或等待自动触发），得到一段**给人看的**提醒：这个对话在做什么、完成了什么、还剩什么、刚才在干嘛。

---

## 🎯 为什么需要它？

长对话有两层遗忘：

1. **compaction summary 是给模型的，不是给你的。** 上下文写满时，Pi 压缩历史让模型继续工作——但那份摘要是机器视角的。几小时后**你**回到会话，没有任何"你当时在哪"的提示。
2. **窗口式 recap 丢大图。** 常见的 `/recap` 实现（如 qwen-code）只总结最后约 30 条消息：长会话里它只告诉你最后一个微步骤，却忘了整体目标。

`pi-session-recap` 提供**面向人类**、基于**完整对话上下文**的 recap。

---

## ✨ 功能

- **`/recap` 命令**——随时手动生成，以非阻塞通知展示。
- **自动触发**——会话运行满 50 分钟（可配置）后，在下一轮对话结束时生成一次，长工作会话持续刷新记忆。
- **完整上下文、含 compaction summary**——读取整个当前分支，反映大图而非最后几条消息。
- **不写入历史**——recap 是用完即弃的 side-query，对话记录保持干净。

---

## 🧠 复用 prompt cache 的设计

与"换上专用短 system prompt"的做法（会打掉缓存前缀）不同，`pi-session-recap` **原样复用主 system prompt 与对话前缀**，仅在末尾追加一条引导消息：

```
主对话：system_prompt + history[0..N]
recap：  system_prompt + history[0..N] + "请用 2-3 句话总结一下这个对话……"

→ 前缀完全一致 → prompt cache 保持可复用
→ 结果从不写入对话历史
```

```
        ┌─────────────────────────────────┐
        │   可缓存的一致前缀               │
        │   system prompt + 完整历史       │
        └─────────────────────────────────┘
                       │
                       ▼
     ┌──────────────────────────────────────────┐
     │ + 尾部引导："用 2-3 句话总结……"           │  ← 仅 side-query
     └──────────────────────────────────────────┘
                       │
                       ▼
              📋 recap 通知（不入史）
```

---

## 📦 安装

```bash
# 开发期显式加载
pi --extension /path/to/pi-session-recap/extensions/session-recap.ts

# 或全局安装：两个文件必须放在同一目录
cp extensions/session-recap.ts extensions/config.ts ~/.pi/agent/extensions/
```

---

## ⚙️ 配置

两层配置合并，**项目优先**：

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
| `autoRecapIntervalMinutes` | number | `50` | 自动 recap 触发间隔（分钟） |

JSON 损坏或字段非法时回落默认值，不抛错。

---

## 🧪 开发

```bash
# 跑测试（纯 Node，毫秒级，被测模块零运行时依赖）
npm test

# 在 Pi 中加载
pi --extension ./extensions/session-recap.ts
```

| 文件 | 职责 |
|---|---|
| `extensions/session-recap.ts` | 扩展入口：`/recap` 命令 + `session_start` / `turn_end` 钩子 |
| `extensions/config.ts` | 配置加载与合并（纯 Node，可独立测试） |
| `tests/config.test.ts` | Node 内置测试套件（`node --test --experimental-strip-types`） |

---

## 📄 许可证

MIT
