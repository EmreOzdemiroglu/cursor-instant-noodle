# Models

The proxy advertises every model it knows about at `/v1/models`. Run `cursor-noodle models` against a running proxy to see the live list.

Every model ID starts with **`n-`** so it never collides with Cursor's built-in model names. You always type the full `n-...` ID.

## Model IDs to add in Cursor

Open Cursor → **Models** → **+ Add Custom Model** and paste the ID from the table below.

### Free — no payment

| Paste in Cursor | Backend | Notes |
|---|---|---|
| `n-gemini-3.5-flash-medium` | Antigravity | Best free default for most tasks |
| `n-gemini-3.5-flash-high` | Antigravity | More reasoning, still fast |
| `n-gemini-3.5-flash-low` | Antigravity | Fastest, lightest reasoning |
| `n-gemini-3.1-pro-low` | Antigravity | Pro model, lighter reasoning |
| `n-gemini-3.1-pro-high` | Antigravity | Pro model, deep reasoning |
| `n-claude-sonnet-4-6` | Antigravity | Excellent reasoning, free |
| `n-claude-opus-4-6-thinking` | Antigravity | Maximum intelligence, free |
| `n-gpt-oss-120b-medium` | Antigravity | Open source via Google's relay |
| `n-glm-4.6` / `n-glm-4.7` / `n-glm-5` / `n-glm-5.1` / `n-glm-5.2` | z.ai | With z.ai coding plan |
| `n-minimax-m3` / `n-minimax-m2.7` / `n-minimax-m2.5` | MiniMax | With MiniMax coding plan |
| `n-zen-north-mini-code-free` | Opencode Zen | Free forever |
| `n-zen-mimo-v2.5-free` | Opencode Zen | Free forever |
| `n-zen-deepseek-v4-flash-free` | Opencode Zen | Free forever |
| `n-lmstudio:<model>` | LMStudio | Whatever you have loaded locally (e.g. `n-lmstudio:qwen3.6-27b`) |
| `n-llamacpp:<model>` | llama.cpp | Whatever you are serving locally (e.g. `n-llamacpp:qwen3.6-27b`) |
| `n-unsloth:<model>` | Unsloth | Whatever you are serving locally (e.g. `n-unsloth:qwen3.6-27b`) |

### Paid — need credits or subscription

| Paste in Cursor | Backend | Approx. cost |
|---|---|---|
| `n-gpt-5.5` / `n-gpt-5.4` / `n-gpt-5.4-mini` | Codex | ChatGPT Plus/Pro sub |
| `n-zen-gpt-5.5` / `n-zen-gpt-5.5-pro` | Opencode Zen | pay-per-token |
| `n-zen-claude-opus-4-8` / `n-zen-claude-opus-4-6` | Opencode Zen | pay-per-token |
| `n-zen-claude-sonnet-4-6` | Opencode Zen | (also free via Antigravity) |
| `n-zen-gemini-3.5-flash` / `n-zen-gemini-3.1-pro` | Opencode Zen | (also free via Antigravity) |
| `n-zen-glm-5.2` / `n-zen-minimax-m3` / `n-zen-kimi-k2.7-code` | Opencode Zen | pay-per-token |
| `n-zen-qwen3.6-plus` / `n-zen-big-pickle` / `n-zen-grok-build-0.1` | Opencode Zen | pay-per-token |
| `n-zen-deepseek-v4-pro` | Opencode Zen | pay-per-token |
| `n-opencode-minimax-m3` / `n-opencode-minimax-m2.7` | Opencode Go | pay-per-token |
| `n-opencode-glm-5.2` / `n-opencode-glm-5.1` | Opencode Go | (cheaper direct via z.ai) |
| `n-opencode-kimi-k2.7-code` | Opencode Go | pay-per-token |
| `n-opencode-qwen3.7-max` / `n-opencode-qwen3.6-plus` | Opencode Go | pay-per-token |
| `n-opencode-deepseek-v4-pro` | Opencode Go | pay-per-token |
| `n-opencode-mimo-v2.5-pro` / `n-opencode-mimo-v2-pro` | Opencode Go | pay-per-token |
| `n-opencode-hy3-preview` | Opencode Go | pay-per-token |

## Why the `n-` prefix?

Cursor's model dropdown ships built-in names like "Gemini 3.5 Flash" that map to its own backend. If you add a custom model with the same name, Cursor can't tell them apart and you get unpredictable routing. Prefixing every model with `n-` (for **n**oodle) guarantees a unique namespace — Cursor always sends the request to the proxy, and the proxy strips the `n-` before talking to the real backend.

## Recommendations by use case

**Daily driver, general coding:** `n-gemini-3.5-flash-medium`
Fast, capable, free. The noodles that get the job done.

**Hard problems / architecture:** `n-claude-sonnet-4-6` (Antigravity, free) or `n-zen-gpt-5.5` (paid)
Both are excellent at multi-step reasoning and large refactors.

**Local / offline / no internet:** `n-lmstudio:qwen3.6-27b` or whatever you have loaded
Free, private, instant. Quality depends on your hardware.

**Code review / careful refactor:** `n-claude-opus-4-6-thinking` (Antigravity, free)
Slower, more thoughtful.

**Trying new things:** `n-zen-big-pickle`, `n-opencode-hy3-preview`, `n-opencode-mimo-v2.5-pro`
These are the "what is this even" tier. Fun to play with.

## Routing cheat sheet

The proxy strips the leading `n-`, then inspects the rest of the model ID to pick a backend. The prefix is the only thing that matters.

```
n-gpt-*         → Codex            (n- stripped)
n-codex*        → Codex            (n- stripped)
n-glm-*         → z.ai             (n- stripped)
n-minimax-*     → MiniMax          (n- stripped)
n-zen-*         → Opencode Zen     (n- stripped, then zen- stripped)
n-opencode-*    → Opencode Go      (n- stripped, then opencode- stripped)
n-lmstudio:*    → LMStudio         (n- stripped, then lmstudio: stripped)
n-llamacpp:*    → llama.cpp        (n- stripped, then llamacpp: stripped)
n-unsloth:*     → Unsloth          (n- stripped, then unsloth: stripped)
n-gemini-*      → Antigravity      (n- stripped)
n-claude-*      → Antigravity      (n- stripped)
n-ag-*          → Antigravity      (n- stripped)
(anything else) → Antigravity
```

You can also drop the `n-` prefix if you want — bare names (`gemini-3.5-flash-medium`) still route correctly for backwards compatibility.
