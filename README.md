# pi-session-recap

**English** | [简体中文](./README.zh-CN.md) | [User Guide](./docs/user-guide.md) | [Architecture Spec](./docs/architecture-spec.md)

Session recap extension for [Pi Coding Agent](https://github.com/earendil-works/pi) — ask `/recap` (or let it trigger automatically) and get a human-readable reminder of what this conversation is about, what is done, what is still open, and what you were doing last.

---

## 🎯 Why pi-session-recap?

Long conversations suffer two kinds of forgetting:

1. **Compaction summaries are for the model, not for you.** When context fills up, Pi compresses history so the model can keep working — but that summary is machine-facing. When *you* come back to a session hours later, there is no equivalent "here's where you were" cue.
2. **Windowed recaps lose the big picture.** Popular `/recap` implementations (e.g. qwen-code) summarize only the last ~30 messages, so on a long session they tell you the last micro-step but forget the overall goal.

`pi-session-recap` gives you a recap built **for humans**, from **full conversation context**.

---

## ✨ Features

- **`/recap` command** — generate a recap on demand, shown as a non-blocking notification.
- **Automatic trigger** — after your session has been running for 50 minutes (configurable), a recap appears after the next completed turn, so a long working session keeps refreshing your memory.
- **Full context, summaries included** — the recap reads the entire current branch, including any compaction summary, so it reflects the big picture rather than the last few turns.
- **Never written to your history** — the recap is a throwaway side-query; your transcript stays clean.

---

## 🧠 Prompt-cache-friendly design

Unlike recaps that swap in a dedicated short system prompt (which invalidates the cached prefix), `pi-session-recap` reuses your **main system prompt and conversation prefix verbatim**, appending one guidance message at the tail:

```
main conversation:   system_prompt + history[0..N]
recap side-query:    system_prompt + history[0..N] + "请用 2-3 句话总结一下这个对话……"

→ identical prefix → prompt cache stays reusable
→ result never appended to the transcript
```

```
        ┌─────────────────────────────────────────┐
        │  identical cacheable prefix             │
        │  system prompt + full history           │
        └─────────────────────────────────────────┘
                          │
                          ▼
     ┌────────────────────────────────────────────────┐
     │ + tail guidance: "summarize in 2-3 sentences…" │   ← side-query only
     └────────────────────────────────────────────────┘
                          │
                          ▼
              📋 recap notification (not stored)
```

---

## 📦 Installation

```bash
# Load explicitly (development)
pi --extension /path/to/pi-session-recap/extensions/session-recap.ts

# Or install globally: both files must sit in the same directory
cp extensions/session-recap.ts extensions/config.ts ~/.pi/agent/extensions/
```

---

## ⚙️ Configuration

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

Malformed JSON or invalid values fall back to defaults — never throws.

---

## 🧪 Development

```bash
# Run tests (pure Node, milliseconds, zero runtime dependencies in the tested module)
npm test

# Load in Pi
pi --extension ./extensions/session-recap.ts
```

| File | Role |
|---|---|
| `extensions/session-recap.ts` | Extension entry: `/recap` command + `session_start` / `turn_end` hooks |
| `extensions/config.ts` | Config loading & merging (pure Node, independently testable) |
| `tests/config.test.ts` | Node built-in test suite (`node --test --experimental-strip-types`) |

---

## 📄 License

MIT
