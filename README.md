# 🍜 Cursor Instant Noodle

> **Cursor on an instant-noodle budget.**

A single OpenAI-compatible endpoint that plugs into Cursor and gives it access to models from many different providers — including free and local ones. Use Antigravity's Gemini 3, your local llama.cpp, Opencode Zen, z.ai GLM, MiniMax, Codex, and more, all from the same Cursor dropdown.

```
Cursor ──► http://localhost:6767/v1 ──►  Antigravity  (Google, free)
                                        Codex      (ChatGPT sub)
                                        z.ai       (GLM coding plan)
                                        MiniMax    (MiniMax coding plan)
                                        Opencode   (Zen + Go)
                                        LMStudio / llama.cpp / Unsloth  (local)
```

![Cursor on an instant-noodle budget](assets/cursor-ramen.png)

## Highlights

- **Free models that actually work** — Gemini 3 Flash, GPT-OSS, GLM-4.6, MiniMax-M3, all through one Cursor dropdown
- **Auto-routing** — model ID prefix decides the backend (`n-glm-*` → z.ai, `n-minimax-*` → MiniMax, etc.)
- **Drop-in OpenAI-compatible** — no Cursor plugin, just paste a base URL
- **🍜 One CLI** — `cursor-noodle start` runs everything (proxy + public tunnel) in the background

## Install

Requires Node.js 18+.

**Option A — npm (from GitHub):**

```bash
npm install -g github:EmreOzdemiroglu/cursor-instant-noodle
cursor-noodle cheapmf     # free-tier fast path: get an Opencode Zen key, use free models
cursor-noodle start       # start proxy + public tunnel
```

**Option B — standalone binary (no Node.js required):**

```bash
curl -fsSL https://raw.githubusercontent.com/EmreOzdemiroglu/cursor-instant-noodle/main/install.sh | bash
```

This downloads a prebuilt binary from the latest [GitHub release](https://github.com/EmreOzdemiroglu/cursor-instant-noodle/releases).

**Option C — from source (dev/contributing):**

```bash
git clone https://github.com/EmreOzdemiroglu/cursor-instant-noodle
cd cursor-instant-noodle
npm install
node bin/cursor-noodle.cjs start
```

> `npm install` also fetches the `cloudflared` binary automatically so the public tunnel works out of the box. If that download fails (offline, rate-limited), the local proxy still works — see [troubleshooting](docs/troubleshooting.md).


## Connect Cursor

1. `Cmd + Shift + J` → **Models** → **OpenAI API**
2. Enable **Override OpenAI Base URL**
3. Paste the URL from `cursor-noodle status` (looks like `https://...trycloudflare.com/v1`)
4. API key: the `instant-noodle-xxxxxxxx` key printed by `cursor-noodle start` (also retrievable with `cursor-noodle key`)
5. Restart Cursor

## API key

The proxy auto-generates an `instant-noodle-xxxxxxxx` API key on first run and stores it in `~/.cursor-noodle/.env`. The proxy rejects requests without a valid `Authorization: Bearer <key>` header (Cursor's model discovery endpoint is exempt so the dropdown can populate).

```bash
cursor-noodle key         # print the current key
cursor-noodle reset-key   # generate a new one (invalidates the old)
```

Regenerate the key if it ever leaks. The proxy hot-reloads new keys on `.env` change, so you don’t need to restart manually.

## Multi-account

Every multi-account provider (Opencode Zen/Go, z.ai, MiniMax, Codex, Antigravity) uses **sticky failover**: account 1 is used until it returns an auth/quota/rate failure, then account 2 is tried silently. The caller only sees an error after every account has been tried. This preserves backend cache affinity and matches the documented behavior in [docs/providers.md](docs/providers.md).


That's it. Now open a chat and click **+ Add Custom Model** to add the models you want. Every model ID starts with **`n-`** (for noodle) so it never collides with Cursor's built-in names — e.g. `n-gemini-3.5-flash-medium`, `n-glm-4.6`, `n-minimax-m3`. See the [model ID cheat sheet](docs/models.md#model-ids-to-add-in-cursor) for the full list.

## Commands

```bash
cursor-noodle cheapmf       # free-tier fast path (Opencode Zen key → DeepSeek/MiMo/North free)
cursor-noodle start         # start proxy + tunnel in the background
cursor-noodle status        # running state + public tunnel URL
cursor-noodle models        # list all available models
cursor-noodle --help        # see all commands (stop, restart, tunnel, logs, setup)
```

Uninstall: `npm uninstall -g cursor-instant-noodle` or run the included `uninstall.sh` (see `./uninstall.sh --help`).

## How it works

1. The proxy starts an Express server on port `6767` (configurable via `PORT`)
2. Spawns a Cloudflare quick tunnel to expose it on a public HTTPS URL — Cursor requires a public base URL, `localhost` does not work
3. Each `/v1/chat/completions` request is dispatched to a provider based on the model ID prefix
4. Antigravity and Codex providers translate OpenAI Chat Completions → their native format
5. Everything else (z.ai, MiniMax, Opencode, local) is a thin OpenAI passthrough
6. The full model list is advertised at `/v1/models` so Cursor's dropdown fills up

See [docs/development.md](docs/development.md) for the architecture in detail.

## Documentation

- **[Why?](docs/why.md)** — the instant-noodle-budget story
- **[Providers](docs/providers.md)** — detailed provider reference
- **[Models](docs/models.md)** — full model list per provider
- **[Cursor setup](docs/cursor-setup.md)** — step-by-step with details
- **[Local models](docs/local.md)** — LMStudio / llama.cpp / Unsloth
- **[Troubleshooting](docs/troubleshooting.md)** — common issues + fixes
- **[Development](docs/development.md)** — build, release, contribute

## Compatibility

- macOS, Linux, Windows (via WSL2 recommended)
- Node.js 18+
- Cursor 0.40+

## Contributing

PRs welcome! See [docs/development.md](docs/development.md) for adding a new provider.

## License

[MIT](LICENSE)