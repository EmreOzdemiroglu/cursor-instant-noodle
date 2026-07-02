# Development

This is a small project. ~1500 lines of code total. Easy to read, easy to extend.

## Layout

```
cursor-instant-noodle/
├── bin/
│   └── cursor-noodle.cjs         # CLI entry point
├── providers/
│   ├── antigravity.cjs       # custom: Google internal format
│   ├── codex.cjs             # custom: codex responses API
│   └── openai-compatible.cjs # passthrough for everything else
├── auth/
│   ├── antigravity.cjs       # OAuth refresh-token exchange
│   ├── codex.cjs             # reads ~/.codex/auth.json
│   └── zai.cjs               # reads opencode auth.json
├── proxy.cjs                 # Express server + routing
├── start.cjs                 # proxy + cloudflared tunnel
├── install.sh / uninstall.sh / release.sh
├── .github/workflows/release.yml
├── docs/                     # documentation
└── package.json
```

## Architecture in one paragraph

The CLI (`bin/cursor-noodle.cjs`) is a commander-based program that manages the lifecycle of a background process. The background process is `start.cjs`, which spawns the Express server (`proxy.cjs`) and the `cloudflared` tunnel. Each request to `/v1/chat/completions` hits `proxy.cjs`, which inspects the model name and delegates to one of three providers. The Antigravity and Codex providers translate the OpenAI chat completions format into their backend's native format. Everything else is an OpenAI-compatible passthrough.

## Add a new provider

The fastest way is to add it to the OpenAI-compatible passthrough:

1. Open `providers/openai-compatible.cjs`
2. Add an entry to the `PROVIDERS` object:
   ```js
   'myprovider': {
       baseURL: process.env.MYPROVIDER_BASE_URL || 'https://api.myprovider.com/v1',
       apiKey: process.env.MYPROVIDER_API_KEY || '...',
       stripPrefix: true,
   },
   ```
3. Add a model prefix to the router in `proxy.cjs`:
   ```js
   if (m.startsWith('myprovider-') || m.startsWith('myprovider:')) {
       return { provider: 'myprovider', targetModel: model };
   }
   ```
4. Add the model to the `MODELS` array in `proxy.cjs` (so Cursor shows it in the dropdown)
5. Document the provider in `docs/providers.md`

If the provider has a non-OpenAI API (like Antigravity and Codex), create a new `providers/myprovider.cjs` instead, with a `chatCompletion({...}, res)` function.

## Build binaries

```bash
npm run build:macos-arm64   # Apple Silicon
npm run build:macos-x64     # Intel Macs
npm run build:linux-x64     # Linux x64
npm run build:linux-arm64   # Linux ARM
npm run build:all           # all of the above
```

Binaries land in `dist/`. Requires [bun](https://bun.sh) installed locally.

## Release a new version

Push a git tag:
```bash
git tag v0.0.2
git push origin v0.0.2
```

The GitHub Action at `.github/workflows/release.yml`:
1. Builds binaries for all 4 platforms
2. Creates `.tar.gz` archives
3. Computes `SHA256SUMS`
4. Creates a GitHub release with the artifacts attached

Then `install.sh` (when run via `curl | bash`) downloads the matching binary from the release.

If you want to release locally (e.g. for testing):
```bash
./release.sh v0.0.2 --no-publish
```

## Run from source

```bash
git clone https://github.com/EmreOzdemiroglu/cursor-instant-noodle
cd cursor-instant-noodle
npm install
node bin/cursor-noodle.cjs start
```

The `node` invocation runs the CLI directly without installing globally.

## Test against a specific provider

```bash
# Start the proxy
node bin/cursor-noodle.cjs start

# Hit the local endpoint
curl -X POST http://localhost:6767/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"glm-4.6","messages":[{"role":"user","content":"hi"}]}'

# Or the public tunnel
curl -X POST https://YOUR-TUNNEL.trycloudflare.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"glm-4.6","messages":[{"role":"user","content":"hi"}]}'
```

## Logs and debugging

The proxy logs to:
- `~/.cursor-noodle/.cursor-noodle.log` (when run via the CLI in the background)
- stdout (when run via `npm start` or `node start.cjs`)

Each request shows: timestamp, model name, routing decision, and "Request finished" on success. Errors include the upstream status code and body.

Add `console.log` statements anywhere — the log file is the only place to look. For deeper debugging, set `DEBUG=*` (not currently implemented but easy to add).

## Code style

- CommonJS (`.cjs` extension). The `type: "module"` in package.json makes `.js` ESM, but we use `.cjs` everywhere to keep it simple.
- async/await for everything that hits the network
- No classes except where they help (e.g. `Provider` in CLI)
- Comments only where the code isn't obvious
- Keep files under 500 lines if possible

## License

MIT. Do what you want.
