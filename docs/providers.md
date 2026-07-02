# Providers

This proxy is a router. It looks at the model name in the request and forwards the request to the matching backend. This page documents every supported provider.

> **Note on model IDs:** every model is advertised with an **`n-`** prefix (e.g. `n-gemini-3.5-flash-medium`) to avoid collisions with Cursor's built-in model names. The IDs listed below are the underlying names — just add `n-` when typing them into Cursor. The `n-` prefix is optional when calling the proxy directly via curl.

## Quick reference

| Provider | Auth | Free? | Models |
|---|---|---|---|
| [Antigravity](#antigravity) | auto (opencode accounts) | free | Gemini 3 Flash/Pro, Claude 4.6, GPT-OSS |
| [Codex / ChatGPT](#codex) | auto (`~/.codex/auth.json`) | with ChatGPT sub | gpt-5.5, gpt-5.4, gpt-5.4-mini |
| [z.ai / GLM](#zai) | env or opencode | with coding plan | GLM-5.2, GLM-4.6 |
| [MiniMax](#minimax) | auto (opencode coding plan) | with coding plan | MiniMax-M3, M2.7, M2.5 |
| [Opencode Zen](#opencode-zen) | `OPENCODE_ZEN_API_KEY` | mostly paid, some free | 50+ models |
| [Opencode Go](#opencode-go) | shared with Zen | mostly paid | MiniMax, Kimi, Qwen, DeepSeek |
| [LMStudio](#lmstudio) | none | free (local) | whatever you load |
| [llama.cpp](#llamacpp) | none | free (local) | whatever you serve |
| [Unsloth](#unsloth) | none | free (local) | whatever you serve |

---

## Antigravity

Google's free IDE gives you access to Gemini 3 Pro, Gemini 3 Flash, Claude Sonnet 4.6, Claude Opus 4.6, and others through your Google account. **No API key needed.** This is the cheapest "good" coding model tier.

**Auth source:** `~/.config/opencode/antigravity-accounts.json` (the file written when you log in to the Antigravity VS Code extension or the `agy` CLI).

If you don't have it: install the Antigravity VS Code extension and log in with Google. The proxy will pick it up automatically.

**Model IDs:**
- `gemini-3.5-flash-medium` / `-high` / `-low` (display: "Gemini 3.5 Flash")
- `gemini-3.1-pro-low` / `-high` (display: "Gemini 3.1 Pro")
- `claude-sonnet-4-6` (display: "Claude Sonnet 4.6")
- `claude-opus-4-6-thinking` (display: "Claude Opus 4.6")
- `gpt-oss-120b-medium` (display: "GPT-OSS 120B")

> Note: as of writing, Antigravity returns "no payment method" for some premium models on accounts without credits. The free models work fine. The proxy passes the error back to Cursor cleanly.

---

## Codex / ChatGPT

If you have a ChatGPT Plus or Pro subscription, you can use the latest GPT-5.x models through Cursor via this proxy — no separate OpenAI API key needed.

**Auth source:** `~/.codex/auth.json` (written by the `codex` CLI when you log in).

If you don't have it: install the `codex` CLI and run `codex` to log in. The proxy will use the stored tokens.

**Model IDs:**
- `gpt-5.5` ← latest, what you'll want most of the time
- `gpt-5.4` ← solid all-rounder
- `gpt-5.4-mini` ← faster, cheaper

> The Codex backend requires streaming; the proxy handles this internally. Non-streaming requests are collected and returned as a single response.

---

## z.ai / GLM

Zhipu AI's GLM models. The coding plan is a flat monthly fee, much cheaper than per-token pricing.

**Auth source:**
- `ZAI_API_KEY` env var (set in `.env`), or
- `zai-coding-plan` key auto-loaded from `~/.local/share/opencode/auth.json`

**Model IDs:**
- `glm-5.2` ← latest flagship
- `glm-5.1`, `glm-5`
- `glm-4.7`, `glm-4.6`

> GLM-5.2 sometimes returns "Insufficient balance" on the free coding plan during peak hours. Drop to `glm-4.6` and try again.

---

## MiniMax

The Chinese AI company MiniMax offers M2 and M3 models on a flat-rate coding plan. The proxy talks to MiniMax's Anthropic-compatible endpoint and translates OpenAI chat completions to it.

**Auth source:**
- `minimax-coding-plan` key auto-loaded from `~/.local/share/opencode/auth.json`, or
- `MINIMAX_API_KEY` env var

**Model IDs:**
- `minimax-m3` ← latest, best quality
- `minimax-m2.7`
- `minimax-m2.5`
- `minimax` (alias for M3)

> M2.7 and M2.5 default to thinking-only output, so the proxy automatically sends `thinking: disabled` to get the actual response. If you want the thinking content, use a direct MiniMax client.

---

## Opencode Zen

50+ curated models, including some free ones and some top-tier paid ones.

**Auth source:** `OPENCODE_ZEN_API_KEY` env var. Get one at https://opencode.ai/zen.

**Free models (no payment method needed):**
- `zen-north-mini-code-free`
- `zen-mimo-v2.5-free`
- `zen-deepseek-v4-flash-free`

**Notable paid models:**
- `zen-gpt-5.5` / `zen-gpt-5.5-pro`
- `zen-claude-opus-4-8`
- `zen-claude-opus-4-6`
- `zen-claude-sonnet-4-6`
- `zen-gemini-3.5-flash`
- `zen-big-pickle`

---

## Opencode Go

A separate endpoint at `https://opencode.ai/zen/go/v1`. Same API key as Zen. Hosts the Chinese open-weight heavyweights.

**Auth source:** `OPENCODE_GO_API_KEY` (falls back to `OPENCODE_ZEN_API_KEY`).

**Notable models:**
- `opencode-minimax-m3`
- `opencode-kimi-k2.7-code`
- `opencode-glm-5.2`
- `opencode-qwen3.7-max`
- `opencode-qwen3.6-plus`
- `opencode-deepseek-v4-pro`
- `opencode-mimo-v2.5-pro`

---

## LMStudio

Run any GGUF model on your machine via LMStudio. The proxy talks to LMStudio's built-in OpenAI-compatible server.

**Setup:**
1. Open LMStudio
2. Load a model (e.g. Qwen2.5-Coder-32B-Instruct)
3. Start the local server (default: `http://localhost:1234/v1`)
4. Use model IDs like `lmstudio:qwen3.6-27b`

**Config (in `.env`):**
```
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_API_KEY=lmstudio
```

The model prefix `lmstudio:` (or `lmstudio-`) is stripped before sending to LMStudio.

---

## llama.cpp

The classic local-inference server. Same OpenAI-compatible protocol.

**Setup:**
1. Run `./server -m model.gguf --port 8080`
2. Use model IDs like `llamacpp:qwen3.6-27b`

**Config:**
```
LLAMACPP_BASE_URL=http://localhost:8080/v1
LLAMACPP_API_KEY=llamacpp
```

---

## Unsloth

Unsloth Studio's local server. Same protocol.

**Config:**
```
UNSLOTH_BASE_URL=http://localhost:11434/v1
UNSLOTH_API_KEY=unsloth
```

Use model IDs like `unsloth:qwen2.5-coder-32b`.
