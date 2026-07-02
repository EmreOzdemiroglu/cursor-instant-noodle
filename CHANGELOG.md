# Changelog

All notable changes to cursor-instant-noodle are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.0.2] — 2026-07-02

### Added
- **`n-` namespace prefix** on every model ID to avoid collisions with Cursor's built-in dropdown. The router strips `n-` automatically.
- **5 reasoning-effort variants per Codex model**: `n-gpt-5.5-{none,light,medium,high,xhigh}` (and same for `n-gpt-5.4-…`). Probed against the Codex backend; only those 5 values are accepted.
- **`cursor-noodle status`** now reports per-provider connection state + per-provider model counts pulled live from `/v1/models`.
- **`cursor-noodle setup`** rewritten as a state-driven menu: each row shows the actual current state (`set` / `empty` / `ready`), enter a row to manage it.
- **Multi-account round-robin** for any API-key provider. Add multiple keys via setup (comma-separated in `.env`) and the proxy cycles through them per request. New `lib/keypool.cjs`.
- **All 19 Opencode Go models** now advertised (was 11).
- `.env.example` documents the comma-separated multi-key format.

### Fixed
- **Codex tool calls now work** end-to-end. The streaming path used to silently drop `response.output_item.added` events, so Cursor saw the model say "I will call get_weather" but never got a tool_call. Now emits tool_calls in OpenAI-compatible shape with proper finish_reason.
- **Antigravity no longer crashes** on tools sent in non-OpenAI shape (`t.function || t` defensive read, same fix as codex).
- **Streaming `finish_reason`** now correctly reports `"tool_calls"` when Antigravity returns `STOP` despite calling a tool (the parser tracks `anyToolCallEmitted`).
- **401 + clean error messages** for auth failures: missing `auth.json`, empty file, no tokens, expired refresh, etc. No more stack-trace leaks to clients.
- **`.gitignore` inline comments** no longer break ignore patterns.
- **README misleading claim** fixed: tunnel is required for Cursor (public URL, not localhost).
- **State files moved** to `~/.cursor-noodle/` so `npm update` no longer wipes user config.
- **`postinstall`** for cloudflared is non-fatal; CLI works without it.

## [0.0.1] — 2026-07-02

### Added
- Initial public release
- **9 providers**: Antigravity (Google Cloud Code), Codex (ChatGPT), z.ai (GLM), MiniMax, Opencode Zen, Opencode Go, LMStudio, llama.cpp, Unsloth
- **51+ models** advertised at `/v1/models`
- Auto-detection of auth tokens from `~/.codex/auth.json`, `~/.local/share/opencode/auth.json`, and similar CLI auth files
- Interactive `cursor-noodle setup` wizard for adding API keys
- Background daemon with PID/lock files (`.cursor-noodle.pid`, `.cursor-noodle.log`)
- Optional Cloudflare quick tunnel via `cloudflared` for public access
- OpenAI-compatible `/v1/chat/completions` and `/v1/models` endpoints
- Streaming (`stream: true`) and non-streaming responses
- Tool calls / function calling on most providers
- Standalone binary build via `bun build --compile`
- Cross-platform install script (`install.sh`) and uninstall script (`uninstall.sh`)
- GitHub Actions workflow for automatic multi-platform binary releases on tag
- Documentation in `docs/`: why, providers, models, cursor-setup, local, troubleshooting, development