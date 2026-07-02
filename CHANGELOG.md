# Changelog

All notable changes to cursor-instant-noodle are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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