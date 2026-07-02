# Cursor setup — step by step

## Step 1 — install and start the proxy

```bash
npm install -g cursor-instant-noodle
cursor-noodle
cursor-noodle start
```

`cursor-noodle start` will print a public tunnel URL like:
```
https://some-words.trycloudflare.com/v1
```

Cursor requires a **public** HTTPS URL — `http://localhost:6767/v1` will not work. Always use the tunnel URL printed by `cursor-noodle start` / `cursor-noodle status`.

## Step 2 — open Cursor settings

Press `Cmd + Shift + J` (macOS) or `Ctrl + Shift + J` (Windows/Linux), or click the ⚙️ gear icon in the bottom-left of Cursor.

The settings panel opens. Click the **Models** tab in the left sidebar.

## Step 3 — configure the OpenAI base URL

In the **API Keys** section (right pane), find the **OpenAI API Key** block:

1. **OpenAI API Key** → toggle **ON**
2. **API key value** → paste the `instant-noodle-xxxxxxxx` key printed by `cursor-noodle start`. The proxy **requires** this exact value to accept requests.
3. **Override OpenAI Base URL** → toggle **ON**
4. **Base URL** → `https://some-words.trycloudflare.com/v1` (from `cursor-noodle status`). Must be the public tunnel URL — `localhost` will not work with Cursor.

> The base URL must end in `/v1`. Cursor appends `/chat/completions` automatically.

### Where to get the API key

The proxy auto-generates a unique key on first run and stores it in `~/.cursor-noodle/.env`. It looks like `instant-noodle-AbCdEfGh`. There are three ways to retrieve it:

```bash
# printed in a yellow box when the proxy first starts
cursor-noodle start

# ask any time afterwards
cursor-noodle key

# regenerate (invalidates the old one; update Cursor after)
cursor-noodle reset-key
```

The proxy hot-reloads new keys when `~/.cursor-noodle/.env` changes, so a `reset-key` does not require restarting the proxy. Cursor will start returning 401s with the old key — that's how you know to update the field.

## Step 4 — add the models you want

Every model the proxy exposes starts with **`n-`** (for **n**oodle). This avoids collisions with Cursor's own built-in model names, so routing is always predictable. You add them as custom models:

Click **+ Add Custom Model** and type the model ID (with the `n-` prefix). A few popular ones:

| Type this in Add Custom Model | Backend | Cost |
|---|---|---|
| `n-gemini-3.5-flash-medium` | Antigravity | free |
| `n-gemini-3.1-pro-high` | Antigravity | free |
| `n-claude-sonnet-4-6` | Antigravity | free |
| `n-gpt-5.5-medium` | Codex / ChatGPT | with Plus/Pro sub |
| `n-glm-4.6` | z.ai | with coding plan |
| `n-minimax-m3` | MiniMax | with coding plan |
| `n-zen-claude-opus-4-6` | Opencode Zen | credits |
| `n-zen-north-mini-code-free` | Opencode Zen | free |
| `n-lmstudio:qwen3.6-27b` | LMStudio | free (local) |
| `n-llamacpp:qwen2.5-coder-32b` | llama.cpp | free (local) |

Run `cursor-noodle models` to see the full list. Toggle each custom model **ON** to enable it.

## Step 5 — pick a model in chat

Open a new chat in Cursor. Click the model dropdown at the top (where it usually says "Auto" or "Claude 3.5 Sonnet"). You'll see:
- Your enabled Cursor built-in models (from Cursor's billing)
- Your enabled custom models (from the proxy)

Pick any. Cursor will send the request to the proxy, which routes it to the right backend.

## Step 6 — verify it's working

After sending a message, check the proxy log:

```bash
tail -f ~/.cursor-noodle/.cursor-noodle.log
```

You should see:
```
[2026-07-02T...] POST /v1/chat/completions
[route] n-gemini-3.5-flash-medium -> antigravity (gemini-3.5-flash-medium)
```

## How routing works

When Cursor sends a request, the proxy first strips the leading **`n-`**, then looks at the rest of the model ID and routes:

| Model name starts with (after `n-`) | Goes to |
|---|---|
| `gpt-` or `codex` | Codex (ChatGPT) |
| `glm-` | z.ai |
| `minimax-` | MiniMax |
| `zen-` | Opencode Zen (prefix stripped) |
| `opencode-` or `go-` | Opencode Go (prefix stripped) |
| `lmstudio:`, `llamacpp:`, `unsloth:` | local server (prefix stripped) |
| Anything else | Antigravity |

The `n-` prefix is optional on the wire (bare names still work) but **required** when adding models in Cursor to avoid name collisions.

## Add more models later

The set of custom models isn't fixed — you can add or remove any time:

1. Go back to Cursor Settings → Models
2. Click **+ Add Custom Model** to add a new one
3. Click the trash icon next to an existing one to remove it

Restart not required — changes are immediate.

## Troubleshooting

**Models dropdown is empty / shows only built-in models**
- Make sure you added custom models via the **+ Add Custom Model** button (Step 4).
- Make sure the model toggle is ON.
- Confirm `/v1/models` returns JSON from the terminal: `curl http://localhost:6767/v1/models`

**"Invalid API Key" error in Cursor**
The proxy checks the API key on every chat request. If Cursor is sending the wrong value (or no value), the proxy itself returns 401 with a message like `Invalid or missing API key. Set the API key in Cursor and try again.`

Fix: paste the `instant-noodle-xxxxxxxx` value from `cursor-noodle key` into Cursor's OpenAI API Key field. If you ever run `cursor-noodle reset-key`, update the field in Cursor too.

If the request reaches the proxy fine (you see `POST /v1/chat/completions` in the log) but still gets a 401/403, the **backend provider** is rejecting your auth — not the proxy. Check the keys in `~/.cursor-noodle/.env` or re-run `cursor-noodle setup`.

**"Network error" or "Could not connect"**
- Is the proxy running? `cursor-noodle status` should show "● running".
- If you used the public tunnel URL and the tunnel disconnected, restart with `cursor-noodle restart`.

**Tunnel URL changes on every restart**
- That's by design (Cloudflare Quick Tunnel is free but ephemeral). Either:
  - Update Cursor's base URL each time
  - Use the public tunnel URL from `cursor-noodle status` (Cursor requires a public URL; `localhost` does not work)

**Model not in dropdown**
- Add it via **+ Add Custom Model** in Cursor's Models settings.

**Free model is rate-limited**
- Free tiers have daily limits. Wait, enable another model, or set up a payment method on the provider's website.
