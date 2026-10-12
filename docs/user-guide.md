# pi-session-recap — User Guide

Quickly recall what you were doing in a long Pi conversation.

## Why

In a long conversation, early context gets compressed away by compaction, and after a while you lose track of: what was the goal, what is done, what is still open. `pi-session-recap` generates a **recap for you (the human)** — distinct from compaction summaries, which exist for the model.

## Install

```bash
# Option A: load explicitly during development
pi --extension /path/to/pi-session-recap/extensions/session-recap.ts

# Option B: global install (subdirectory entry point)
mkdir -p ~/.pi/agent/extensions/session-recap
cp extensions/session-recap.ts ~/.pi/agent/extensions/session-recap/index.ts
cp extensions/config.ts     ~/.pi/agent/extensions/session-recap/config.ts
```

> **Why a subdirectory?** Pi loads every top-level `.ts` file in `~/.pi/agent/extensions/` as its own extension. `config.ts` has no default export and would raise a load error if copied flat. The subdirectory pattern (`index.ts` as the entry) keeps `config.ts` as an internal module. Symlinks inside the subdirectory work as well.

## Usage

### Manual

Type at any time:

```
/recap
```

A notification like this appears (15 s, non-blocking):

```
📋 这个对话在重构认证模块，添加 OAuth2 支持。已完成登录流程与 token 生成；
还在做 token 刷新（卡在 race condition）；最后几轮在调试测试用例。
```

### Automatic

Once a session has been running for **50 minutes** (default), the next completed turn triggers a recap automatically. After each auto-recap the timer resets.

Recap works at any time; the only exception is a brand-new session with an empty history. Manual `/recap` is never rate-limited.

## Configuration

Two files are merged, **project wins**:

| Layer | Path |
|---|---|
| Global | `~/.pi/agent/extensions/session-recap.json` |
| Project | `<cwd>/.pi/session-recap.json` |

```json
{
  "autoRecap": true,
  "autoRecapIntervalMinutes": 50
}
```

| Key | Type | Default | Description |
|---|---|---|---|
| `autoRecap` | boolean | `true` | Enable the automatic recap |
| `autoRecapIntervalMinutes` | number | `50` | Minutes of session time between automatic recaps |

Malformed JSON or invalid values silently fall back to defaults (never throws).

## Design notes

- **Cache friendly**: the recap is a side-query that reuses your main system prompt and appends one guidance message at the tail — the prefix stays cacheable. No special recap system prompt.
- **Full context, including compaction summaries**: the recap reads the whole current branch, so it reflects the big picture, not just the last few turns.
- **Never written to history**: results are shown via notification only; your transcript stays clean.
- **Lightweight model**: prefers `gemini-2.5-flash`, then `gpt-4.1-mini`, then `claude-3-5-haiku-20241022`; if none is configured, falls back to the current session model so recap works with any provider setup.

## Requirements

- [Pi Coding Agent](https://github.com/earendil-works/pi)
- Peer dependencies: `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent` (provided by Pi itself)

## License

MIT
