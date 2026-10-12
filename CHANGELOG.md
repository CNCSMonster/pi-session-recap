# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-10-13

### Fixed
- **Proper model fallback chain**: lightweight model candidates are now checked one by one for "exists **and** authenticated". Previously the first `find()` result was taken even when unauthenticated, causing recap to fail instantly on setups where those models appear in the catalog without credentials.

## [0.1.1] - 2026-10-13

### Fixed
- **Recap now works at any time**: removed the arbitrary "at least 3 messages" threshold; only a brand-new session with an empty history is skipped (with a clear notice for `/recap`).
- **Current-model fallback**: when none of the lightweight models (`gemini-2.5-flash` / `gpt-4.1-mini` / `claude-3-5-haiku-20241022`) is configured, the recap side-query falls back to the current session model instead of failing.

## [0.1.0] - 2026-10-13

### Added
- **Initial release of `pi-session-recap`.**
- **`/recap` command**: generate a human-readable session recap (goal, completed work, open work, last steps) on demand; shown as a non-blocking 15-second notification.
- **Automatic recap**: triggers after the session has been running for 50 minutes (configurable), on the next completed turn; timer resets after each recap; requires at least 3 user/assistant messages.
- **Prompt-cache-friendly side-query design**: reuses the main system prompt and full conversation prefix verbatim, appending a single guidance message at the tail instead of using a dedicated recap system prompt.
- **Full-context summaries**: reads the entire current branch (including compaction summaries), not a trailing message window, so long conversations keep their big picture.
- **History isolation**: recap results are rendered only; nothing is appended to the transcript. Uses an isolated `sessionId` with `cacheRetention: "none"`.
- **Two-layer configuration** (`~/.pi/agent/extensions/session-recap.json` global, `<cwd>/.pi/session-recap.json` project, project wins): `autoRecap` (default `true`), `autoRecapIntervalMinutes` (default `50`); malformed or invalid values fall back to defaults without throwing.
- **Model fallback chain**: `google/gemini-2.5-flash` → `openai/gpt-4.1-mini` → `anthropic/claude-3-5-haiku-20241022`, first with configured auth.
- **Test suite**: 6 pure-Node config tests running on `node --test --experimental-strip-types` (milliseconds, zero runtime dependencies).
- Bilingual user guide (`docs/user-guide.md`, `docs/user-guide.zh-CN.md`) and architecture spec (`docs/architecture-spec.md`).
