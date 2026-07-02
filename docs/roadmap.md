# Roadmap

This is a living document of what's planned. Priorities shift based on
what users actually ask for. If you want something that's not here,
open a [feature request](https://github.com/EmreOzdemiroglu/cursor-instant-noodle/issues/new/choose).

## 🍜 The thesis

Cursor's built-in model list is expensive and limited. The "free provider
aggregator" race is already crowded — that alone is not the goal. The bet
is **aggregating what you already pay for** (ChatGPT sub, Google account,
Amazon Q, Claude sub) plus **free tiers** into a single Cursor dropdown,
and then **making every token go further**.

## In progress / next up

### Token optimization
Intercept tool/command output at the proxy layer and compress it before
it reaches the model — dedup repeated `cat`/`read` output, shorten
`ls`/`tree`, compact `git diff`. The goal is **2x your quota** with no
model-side changes. Inspiration: [rtk-ai/rtk](https://github.com/rtk-ai/rtk)
(which claims 60-90% reduction). If a clean library exists we'll use it;
otherwise a deterministic rules-based pass first, ML-based later.

### Statistics (`cursor-noodle stats`)
Per-provider token usage, request counts, and an estimated "you saved $X
vs Cursor Pro this month" figure. People want to see the win. Likely a
parse of `~/.cursor-noodle/.cursor-noodle.log` plus a small SQLite store.
Outputs a shareable card for the screenshot crowd.

### Auto router
Pick the cheapest model that's "good enough" for the request instead of
forcing the user to choose. E.g. a quick syntax fix routes to a free
local model, a refactor routes to a mid-tier, a hard plan routes to the
flagship. Similar to what [openproxy](https://github.com/quangdang46/openproxy)
does, but tuned for the subscription + free-tier mix.

## Considering

### Free gateway providers (Kiro / Amazon Q, Google AI Studio, OpenRouter)
- **Kiro / Amazon Q Developer** — free Claude models. Probably the single
  most-requested feature on r/cursor. Would add a `providers/kiro.cjs`.
- **Google AI Studio** — free Gemini 2.5 Pro (1500 req/day), an
  Antigravity alternative that doesn't need the OAuth dance.
- **OpenRouter** — one key, 280+ models, lots of free tiers. Useful as a
  long-tail fallback.
- **Claude Pro/Max subscription** — OAuth like Codex/Antigravity, so the
  Claude sub works in Cursor without per-token costs.

### Prompt caching
Anthropic and others offer ~90% discount on cache hits. Wire it through
the Codex/Antigravity paths.

### Beyond Cursor
The proxy speaks plain OpenAI Chat Completions, so it already works with
Windsurf, Roo, Cline, Continue, and the Codex CLI. Reposition the docs
from "Cursor only" to "any OpenAI-compatible tool" and add per-tool
auto-configure helpers.

### Live TUI dashboard
`cursor-noodle top` — a `btop`-style live view of token flow, cost,
provider health, and failover events. Pure eye candy, but sticky.

## Done

See the [changelog](CHANGELOG.md) and [commit history](https://github.com/EmreOzdemiroglu/cursor-instant-noodle/commits/main).
