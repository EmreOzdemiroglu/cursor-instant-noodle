# Running local models

The cheapest possible setup: a model running on your own machine. No API costs, no rate limits, fully private. The trade-off is quality per dollar of hardware — a 32B Qwen on an M3 Mac is great; a 7B on a laptop is "fine for autocomplete."

The proxy talks to three local servers that all implement the OpenAI chat completions protocol: LMStudio, llama.cpp, and Unsloth.

## Pick a model first

For coding, the current sweet spot is **Qwen2.5-Coder-32B** (or 14B if you're memory-constrained). It's smart enough for most tasks and small enough to run on a Mac Studio or a desktop with 32GB+ RAM.

For Macs, **Qwen3.5** and **Qwen3.6** are also good. **MiniMax-M3** is competitive with frontier models at smaller sizes.

## LMStudio (easiest)

LMStudio is a desktop app. Download from https://lmstudio.ai.

1. Open LMStudio
2. Search for a model (e.g. "Qwen2.5-Coder-32B-Instruct-GGUF")
3. Download a Q4_K_M or Q5_K_M quant (balance of speed and quality)
4. Click the **Developer** tab (the `</>` icon in the sidebar)
5. Click **Start Server**. The default port is `1234`.
6. In Cursor, use the model: `lmstudio:qwen2.5-coder-32b-instruct`

The proxy auto-detects LMStudio at `http://localhost:1234/v1`. To change the URL, set `LMSTUDIO_BASE_URL` in `.env`.

**Tip:** LMStudio's server only accepts requests from `localhost` by default. That's fine for Cursor on the same machine. If you need to reach it from another machine, enable the CORS / network toggle in LMStudio's server settings.

## llama.cpp (the original)

Compile llama.cpp with server support:
```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
make server
```

Run it:
```bash
./server -m /path/to/model.gguf --port 8080 -c 8192
```

The default URL is `http://localhost:8080/v1`. Use model IDs like `llamacpp:llama-3.3-70b-instruct-q5_k_m`.

## Unsloth

Unsloth Studio runs a similar OpenAI-compatible server. The default port is `11434`. Use `unsloth:modelname`.

## Memory and quant

- 7B models in Q4: ~5 GB RAM
- 14B models in Q4: ~10 GB RAM
- 32B models in Q4: ~22 GB RAM
- 70B models in Q4: ~45 GB RAM

If you have a Mac with unified memory, the GPU and CPU share it, so a 32B Q4 in Q8_0 (≈ 35 GB) is feasible on a 64 GB M2/M3.

## Multiple local models

The proxy only knows about one local server per provider (LMStudio, llamacpp, unsloth). If you want to run multiple models, run multiple servers on different ports and update `.env`:

```bash
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_API_KEY=model-a

LLAMACPP_BASE_URL=http://localhost:8080/v1
LLAMACPP_API_KEY=model-b
```

The model name in Cursor (`lmstudio:qwen2.5-coder-32b`) determines which server the request goes to.

## When local models make sense

- You already have a beefy machine and it sits idle most of the day
- You're working on proprietary code that shouldn't leave your machine
- You want to experiment with open-weight models without paying per token
- You're on a laptop and care about battery life
- You need the absolute best model (frontier APIs still win on hard problems)
