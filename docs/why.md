# Why? — Cursor on an instant-noodle budget

![Cursor on an instant-noodle budget](../assets/cursor-ramen.png)

## The problem

Cursor's built-in models are great. They're also expensive. If you're a heavy user, a single day of agentic work can rack up $5–$20 in API costs. For students, hobbyists, and people outside the US, that adds up fast.

You don't have to pay that. Most of the same models — and several that Cursor doesn't expose — are available through other channels that cost $0 to a few dollars per month:

- **Antigravity** (Google's free IDE): gives you Gemini 3 Pro, Gemini 3 Flash, and Claude Sonnet 4.6 through your Google account. Free.
- **Opencode Zen**: 50+ curated models, some free forever (`zen-north-mini-code-free`, `mimo-v2.5-free`, `deepseek-v4-flash-free`)
- **z.ai coding plan**: GLM-5.2 and friends for a flat monthly fee
- **Codex / ChatGPT**: comes with your ChatGPT Plus/Pro subscription
- **Your own machine**: a 35B Qwen running on your RTX3090 is good enough for most coding tasks, and the electricity is negligible

## The solution

`cursor-instant-noodle` is a thin OpenAI-compatible server that exposes all of these as a single endpoint. You point Cursor at it once, and the model dropdown fills up with every model the proxy knows about. Cursor doesn't know — or care — that some of them are paid APIs, some are free, and some are running on your laptop. It just sends the request to the proxy, which routes it to the right backend.

## The vibe

Instant noodles are the perfect metaphor:

- **Not fancy.** It's plain JavaScript, not a Rust rewrite of vLLM. No benchmarks, no leaderboards.
- **Fast.** Install in one line. The proxy is in-memory, no database, no queue.
- **Cheap.** Most of the model options cost $0. The most expensive tier is "a few dollars a month."
- **Surprisingly good.** The free models are usually enough. The paid ones are usually overkill.
- **Mix and match.** Use the local Qwen for autocomplete, Antigravity's Gemini 3 Pro for hard problems, and Codex for everything else. Same chat, same UI, same context.

## Who is this for

- Students and hobbyists who don't want to pay $20/month for Cursor Pro on top of API costs
- People who want Antigravity and Codex models inside Cursor without installing extra provider CLIs
- People with a beefy laptop or desktop who want to run local models for free
- Anyone who wants to A/B test models side-by-side without rewriting their setup
- The AI-curious who want to see what GLM or Kimi can do without opening 12 accounts

## Who this is NOT for

- If you're fine paying for Cursor's built-in models and want zero friction, this is overkill.
- If you need a production-grade, highly-available model gateway, look at LiteLLM or OpenRouter.
- If you only use one model, this adds a layer of indirection you don't need.

## The license

MIT. Do whatever you want with it.
