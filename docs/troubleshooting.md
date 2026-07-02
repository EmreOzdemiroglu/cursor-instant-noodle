# Troubleshooting

## "Connection refused" / proxy won't start

```bash
$ cursor-noodle start
✗ node_modules not found. Run `npm install` first.
```

You probably ran `cursor-noodle` from a directory that doesn't have the package. Either:

- `cd` into the project directory and run `cursor-noodle start` directly
- Or use the npm-installed global version: `npm install -g github:EmreOzdemiroglu/cursor-instant-noodle` then `cursor-noodle start` from anywhere

## "EADDRINUSE :::6767"

Port 6767 is taken. Either:
- Find and kill the old process: `lsof -ti :6767 | xargs kill -9`
- Or change the port: `PORT=7000 cursor-noodle start` (also update Cursor's base URL)

## "No auth found" / OAuth unavailable

Run:

```bash
cursor-noodle setup
```

Then pick Codex or Antigravity and sign in from the browser flow. Credentials are written to `~/.cursor-noodle/.env`; if the proxy is already running, run `cursor-noodle restart` after setup.

Codex CLI / opencode / agy auth files are intentionally ignored. Noodle owns its own auth state.

## "Invalid API key" in Cursor

This is normal. The proxy doesn't check the API key — it just forwards the request. If you see a 401/403 in the proxy log (`tail -f ~/.cursor-noodle/.cursor-noodle.log`), the real backend is rejecting auth. Check:

- `OPENCODE_ZEN_API_KEY` is correct in `.env`
- `ZAI_API_KEY` is correct (or remove it to use the opencode fallback)
- For Codex: run `cursor-noodle setup` and sign in again
- For Antigravity: run `cursor-noodle setup` and sign in again

## Tunnel URL keeps changing

Cloudflare Quick Tunnels are free and ephemeral. The URL changes every time you restart `cursor-noodle`. Options:

1. **Use the local URL** (`http://localhost:6767/v1`) — works fine if Cursor runs on the same machine. Recommended.
2. **Set up a named tunnel** (free, fixed URL) — see Cloudflare's docs. Requires a Cloudflare account and a domain.
3. **Use ngrok or similar** — replace the `cloudflared` invocation in `start.cjs` with your own tunnel binary.

## "Model not supported" / 404

The model name on the API side doesn't exist. Common causes:

- `gemini-3.1-pro-high` — the actual API name is `gemini-3.1-pro` with a `thinkingLevel: high` config. The proxy handles this mapping, but if the API returns 400, the model might not be available on your account.
- `gpt-5.5` on Codex — the Codex backend may not support that exact name. Check the response with `cursor-noodle logs` for the actual error.
- `glm-5.2` on z.ai — returns "Insufficient balance" on the free coding plan. Try `glm-4.6` instead.

## Models dropdown is empty in Cursor

1. Make sure the proxy is running: `cursor-noodle status` should show "● running"
2. Confirm `/v1/models` returns JSON: `curl http://localhost:6767/v1/models`
3. Make sure you added custom models via **+ Add Custom Model** in Cursor's Models settings, and that the toggle is ON.
4. Restart Cursor fully (`Cmd + Q` and reopen). The dropdown doesn't always refresh when settings change.

## Free model is rate-limited

Free tiers have daily or hourly quotas. When you hit one:
- The proxy returns the rate-limit error to Cursor
- Cursor will show a "rate limited" message
- Enable another custom model in Cursor's Models settings, or wait for the quota to reset

## Performance is slow on the first request

The first request after startup triggers an auth refresh (Antigravity refreshes its OAuth token, etc.). This adds 1-2 seconds. Subsequent requests are fast.

If every request is slow, the issue is likely:
- Network latency to the upstream (Antigravity, z.ai, etc.)
- A thinking model with `thinkingLevel: high` is doing a lot of work
- Your local model is running on a CPU instead of GPU

## Cloudflared won't download

The `postinstall` script downloads `cloudflared` from GitHub. If it fails:

- Check your network: `curl -I https://github.com/cloudflare/cloudflared/releases/latest`
- GitHub might be rate-limiting. Wait a few minutes and run `npm install` again.
- Or download manually and place the `cloudflared` binary in the project root.

## "Address already in use" on 6767

`lsof -ti :6767 | xargs kill -9` then `cursor-noodle start`.

## Want to use a model that's not in the list

Add it via Cursor's Models settings: **+ Add Custom Model**, type the model ID, toggle ON. The prefix (`gpt-`, `glm-`, `zen-`, etc.) routes it to the right backend.

If the model isn't being recognized (returns an error), it may not be in the proxy's MODELS list. Edit the `MODELS` array in `proxy.cjs` and run `cursor-noodle restart`.
