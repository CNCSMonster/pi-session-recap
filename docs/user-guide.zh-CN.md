# pi-session-recap — 用户手册

快速回忆长对话中你之前在做什么。

## 为什么需要它

长对话里早期上下文会被 compaction 压缩掉，一段时间后你会忘记：大目标是什么、完成了什么、还剩什么。`pi-session-recap` 生成的是**给人（你）看的 recap**——与给模型用的 compaction summary 是两回事。

## 安装

```bash
# 方式 A：开发期显式加载
pi --extension /path/to/pi-session-recap/extensions/session-recap.ts

# 方式 B：全局安装（子目录入口）
mkdir -p ~/.pi/agent/extensions/session-recap
cp extensions/session-recap.ts ~/.pi/agent/extensions/session-recap/index.ts
cp extensions/config.ts     ~/.pi/agent/extensions/session-recap/config.ts
```

> **为什么用子目录？** Pi 会把 `~/.pi/agent/extensions/` 顶层的每个 `.ts` 文件都当作独立扩展加载；`config.ts` 没有 default 导出，平铺拷贝会触发加载报错。子目录模式（`index.ts` 为入口）让 `config.ts` 只作为内部模块。目录内用软链同样可行。

## 使用

### 手动触发

随时输入：

```
/recap
```

随后弹出通知（15 秒，不阻塞）：

```
📋 这个对话在重构认证模块，添加 OAuth2 支持。已完成登录流程与 token 生成；
还在做 token 刷新（卡在 race condition）；最后几轮在调试测试用例。
```

### 自动触发

会话持续 **50 分钟**（默认）后，下一轮对话结束时自动生成一次 recap，之后计时重置。
对话至少有 3 条 user/assistant 消息才会生成。

## 配置

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

JSON 损坏或字段非法时静默回落默认值，不会抛错。

## 设计说明

- **复用 prompt cache**：recap 是 side-query，沿用主对话 system prompt，仅在末尾追加一条引导消息——前缀保持可缓存，不用专用 recap system prompt。
- **取完整分支上下文（含 compaction summary）**：不是只取最后几条，长会话不会丢"大目标"。
- **不写入历史**：结果只通过通知展示，对话记录保持干净。
- **轻量模型**：优先 `gemini-2.5-flash`，其次 `gpt-4.1-mini`，再次 `claude-3-5-haiku-20241022`——取第一个已配置认证的。

## 依赖

- [Pi Coding Agent](https://github.com/earendil-works/pi)
- Peer 依赖：`@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent`（由 Pi 自身提供）

## 许可证

MIT
