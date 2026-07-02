const express = require('express');
const crypto = require('crypto');
const antigravity = require('./providers/antigravity.cjs');
const codex = require('./providers/codex.cjs');
const minimax = require('./providers/minimax.cjs');
const openaiCompat = require('./providers/openai-compatible.cjs');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Models list for Cursor's model discovery
const MODELS = [
    // --- Antigravity ---
    { id: 'gemini-3.5-flash-medium', provider: 'antigravity', name: 'Gemini 3.5 Flash (Medium)', desc: 'Fast with balanced reasoning', icon: '⚡' },
    { id: 'gemini-3.5-flash-high', provider: 'antigravity', name: 'Gemini 3.5 Flash (High)', desc: 'Flash with higher reasoning', icon: '⚡' },
    { id: 'gemini-3.5-flash-low', provider: 'antigravity', name: 'Gemini 3.5 Flash (Low)', desc: 'Fastest responses', icon: '⚡' },
    { id: 'gemini-3.1-pro-low', provider: 'antigravity', name: 'Gemini 3.1 Pro (Low)', desc: 'Pro model, lighter reasoning', icon: '🍜' },
    { id: 'gemini-3.1-pro-high', provider: 'antigravity', name: 'Gemini 3.1 Pro (High)', desc: 'Pro model, deep reasoning', icon: '🍜' },
    { id: 'claude-sonnet-4-6', provider: 'antigravity', name: 'Claude Sonnet 4.6 (Thinking)', desc: 'Advanced reasoning + extended thinking', icon: '🍜' },
    { id: 'claude-opus-4-6-thinking', provider: 'antigravity', name: 'Claude Opus 4.6 (Thinking)', desc: 'Maximum intelligence', icon: '🍜' },
    { id: 'gpt-oss-120b-medium', provider: 'antigravity', name: 'GPT-OSS 120B (Medium)', desc: 'Open source via Antigravity', icon: '🍜' },

    // --- MiniMax ---
    { id: 'minimax-m3', provider: 'minimax', name: 'MiniMax M3', desc: 'MiniMax coding plan', icon: '🍜' },
    { id: 'minimax-m2.7', provider: 'minimax', name: 'MiniMax M2.7', desc: 'MiniMax coding plan', icon: '🍜' },
    { id: 'minimax-m2.5', provider: 'minimax', name: 'MiniMax M2.5', desc: 'MiniMax coding plan', icon: '🍜' },

    // --- Codex (ChatGPT) — each model exposes 5 reasoning-effort variants ---
    { id: 'gpt-5.5-none', provider: 'codex', name: 'GPT-5.5 (no reasoning)', desc: 'Fastest, no chain-of-thought', icon: '🍜' },
    { id: 'gpt-5.5-light', provider: 'codex', name: 'GPT-5.5 (light reasoning)', desc: 'Light reasoning, fast', icon: '🍜' },
    { id: 'gpt-5.5-medium', provider: 'codex', name: 'GPT-5.5 (medium reasoning)', desc: 'Balanced reasoning (default)', icon: '🍜' },
    { id: 'gpt-5.5-high', provider: 'codex', name: 'GPT-5.5 (high reasoning)', desc: 'Deep reasoning, slower', icon: '🍜' },
    { id: 'gpt-5.5-xhigh', provider: 'codex', name: 'GPT-5.5 (xhigh reasoning)', desc: 'Maximum reasoning', icon: '🍜' },

    { id: 'gpt-5.4-none', provider: 'codex', name: 'GPT-5.4 (no reasoning)', desc: 'Fastest', icon: '🍜' },
    { id: 'gpt-5.4-light', provider: 'codex', name: 'GPT-5.4 (light reasoning)', desc: 'Light reasoning', icon: '🍜' },
    { id: 'gpt-5.4-medium', provider: 'codex', name: 'GPT-5.4 (medium reasoning)', desc: 'Balanced', icon: '🍜' },
    { id: 'gpt-5.4-high', provider: 'codex', name: 'GPT-5.4 (high reasoning)', desc: 'Deep reasoning', icon: '🍜' },
    { id: 'gpt-5.4-xhigh', provider: 'codex', name: 'GPT-5.4 (xhigh reasoning)', desc: 'Maximum reasoning', icon: '🍜' },

    { id: 'gpt-5.4-mini', provider: 'codex', name: 'GPT-5.4 Mini (Codex)', desc: 'Faster, cheaper GPT-5.4', icon: '🍜' },

    // --- z.ai (GLM) ---
    { id: 'glm-5.2', provider: 'zai', name: 'GLM-5.2 (z.ai)', desc: 'Latest z.ai flagship', icon: '🇿' },
    { id: 'glm-5.1', provider: 'zai', name: 'GLM-5.1 (z.ai)', desc: 'z.ai', icon: '🇿' },
    { id: 'glm-5', provider: 'zai', name: 'GLM-5 (z.ai)', desc: 'z.ai', icon: '🇿' },
    { id: 'glm-4.7', provider: 'zai', name: 'GLM-4.7 (z.ai)', desc: 'z.ai', icon: '🇿' },
    { id: 'glm-4.6', provider: 'zai', name: 'GLM-4.6 (z.ai)', desc: 'z.ai', icon: '🇿' },

    // --- Opencode Zen ---
    { id: 'zen-gpt-5.5', provider: 'zen', name: 'Zen · GPT-5.5', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-gpt-5.5-pro', provider: 'zen', name: 'Zen · GPT-5.5 Pro', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-claude-opus-4-8', provider: 'zen', name: 'Zen · Claude Opus 4.8', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-claude-opus-4-6', provider: 'zen', name: 'Zen · Claude Opus 4.6', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-claude-sonnet-4-6', provider: 'zen', name: 'Zen · Claude Sonnet 4.6', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-gemini-3.5-flash', provider: 'zen', name: 'Zen · Gemini 3.5 Flash', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-gemini-3.1-pro', provider: 'zen', name: 'Zen · Gemini 3.1 Pro', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-glm-5.2', provider: 'zen', name: 'Zen · GLM-5.2', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-minimax-m3', provider: 'zen', name: 'Zen · MiniMax M3', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-kimi-k2.7-code', provider: 'zen', name: 'Zen · Kimi K2.7', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-qwen3.6-plus', provider: 'zen', name: 'Zen · Qwen 3.6 Plus', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-big-pickle', provider: 'zen', name: 'Zen · Big Pickle', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-grok-build-0.1', provider: 'zen', name: 'Zen · Grok Build', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-deepseek-v4-pro', provider: 'zen', name: 'Zen · DeepSeek V4 Pro', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-deepseek-v4-flash-free', provider: 'zen', name: 'Zen · DeepSeek V4 Flash (Free)', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-mimo-v2.5-free', provider: 'zen', name: 'Zen · MiMo v2.5 (Free)', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-north-mini-code-free', provider: 'zen', name: 'Zen · North Mini Code (Free)', desc: 'Opencode Zen', icon: '🍜' },

    // --- Opencode Go (opencode.ai/zen/go/v1) ---
    { id: 'opencode-minimax-m3', provider: 'opencode', name: 'Opencode · MiniMax M3', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-minimax-m2.7', provider: 'opencode', name: 'Opencode · MiniMax M2.7', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-minimax-m2.5', provider: 'opencode', name: 'Opencode · MiniMax M2.5', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-glm-5.2', provider: 'opencode', name: 'Opencode · GLM-5.2', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-glm-5.1', provider: 'opencode', name: 'Opencode · GLM-5.1', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-glm-5', provider: 'opencode', name: 'Opencode · GLM-5', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-kimi-k2.7-code', provider: 'opencode', name: 'Opencode · Kimi K2.7', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-kimi-k2.6', provider: 'opencode', name: 'Opencode · Kimi K2.6', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-kimi-k2.5', provider: 'opencode', name: 'Opencode · Kimi K2.5', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-qwen3.7-max', provider: 'opencode', name: 'Opencode · Qwen 3.7 Max', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-qwen3.7-plus', provider: 'opencode', name: 'Opencode · Qwen 3.7 Plus', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-qwen3.6-plus', provider: 'opencode', name: 'Opencode · Qwen 3.6 Plus', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-qwen3.5-plus', provider: 'opencode', name: 'Opencode · Qwen 3.5 Plus', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-deepseek-v4-pro', provider: 'opencode', name: 'Opencode · DeepSeek V4 Pro', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-deepseek-v4-flash', provider: 'opencode', name: 'Opencode · DeepSeek V4 Flash', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-mimo-v2.5-pro', provider: 'opencode', name: 'Opencode · MiMo v2.5 Pro', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-mimo-v2.5', provider: 'opencode', name: 'Opencode · MiMo v2.5', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-mimo-v2-pro', provider: 'opencode', name: 'Opencode · MiMo v2 Pro', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-mimo-v2-omni', provider: 'opencode', name: 'Opencode · MiMo v2 Omni', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-hy3-preview', provider: 'opencode', name: 'Opencode · Hy3 Preview', desc: 'Opencode Go', icon: '🍜' },

    // --- Local: LMStudio ---
    { id: 'lmstudio:qwen3.6-27b', provider: 'lmstudio', name: 'LMStudio · Qwen3.6 27B', desc: 'Local', icon: '🍜' },
    { id: 'lmstudio:qwen2.5-coder-32b', provider: 'lmstudio', name: 'LMStudio · Qwen2.5 Coder 32B', desc: 'Local', icon: '🍜' },

    // --- Local: llama.cpp ---
    { id: 'llamacpp:qwen3.6-27b', provider: 'llamacpp', name: 'llama.cpp · Qwen3.6 27B', desc: 'Local', icon: '🍜' },

    // --- Local: Unsloth ---
    { id: 'unsloth:qwen3.6-27b', provider: 'unsloth', name: 'Unsloth · Qwen3.6 27B', desc: 'Local', icon: '🍜' },
];

app.get('/', (req, res) => {
    const cards = MODELS.map(m => `
        <div style="background:#1a1b1e;border:1px solid #333;padding:12px;border-radius:8px;margin:8px 0;display:flex;align-items:center;gap:12px;">
            <div style="font-size:20px;">${m.icon}</div>
            <div style="flex:1;">
                <div style="font-weight:bold;color:#fff;">${m.name}</div>
                <div style="color:#888;font-size:12px;">${m.desc} · <span style="color:#61afef;">${m.provider}</span></div>
                <code style="color:#abb2bf;font-size:11px;">ID: ${m.id}</code>
            </div>
        </div>`).join('');
    res.send(`<!DOCTYPE html>
<html><head><title>Cursor Instant Noodle</title></head>
<body style="background:#0d0e12;color:#fff;font-family:-apple-system,sans-serif;padding:20px;">
<div style="max-width:700px;margin:0 auto;">
<h1 style="text-align:center;margin-bottom:4px;">🍜 Cursor Instant Noodle</h1>
<p style="text-align:center;color:#888;margin-bottom:24px;">Antigravity · Codex · z.ai/GLM · Opencode Zen · LMStudio · llama.cpp · Unsloth</p>
<div style="background:#16171d;border:1px solid #333;padding:16px;border-radius:8px;margin-bottom:16px;">
    <div style="font-weight:bold;color:#00ff88;">✓ Running on port ${process.env.PORT || 6767}</div>
    <div style="font-size:13px;">Base URL: <code style="background:#000;padding:2px 6px;border-radius:3px;">/v1</code></div>
</div>
<h3 style="margin-left:4px;margin-bottom:8px;">Available Models</h3>
${cards}
<div style="text-align:center;padding:16px;color:#555;font-size:11px;">Cursor Instant Noodle v1.0.0</div>
</div></body></html>`);
});

app.get(['/v1/models', '/models'], (req, res) => {
    res.json({
        object: 'list',
        data: MODELS.map(m => ({
            // Advertise every model with an `n-` prefix so the IDs never collide
            // with Cursor's built-in model names (e.g. "Gemini 3.5 Flash").
            id: 'n-' + m.id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: m.provider,
        })),
    });
});

// Provider router: detect provider from model name.
// A leading `n-` is stripped first (it's just a collision-avoidance prefix
// for Cursor's model dropdown — providers never see it).
function detectProvider(model) {
    if (!model) return { provider: 'antigravity', targetModel: model };

    // Strip the `n-` namespace prefix if present.
    let m = model;
    if (m.toLowerCase().startsWith('n-')) {
        m = m.slice(2);
    }
    const lower = m.toLowerCase();
    // targetModel is always the de-namespaced name (no `n-`, no provider prefix
    // for zen/opencode/local — those providers strip their own prefix too).

    // Codex models
    if (lower.startsWith('gpt-') || lower === 'codex' || lower.startsWith('codex-')) {
        return { provider: 'codex', targetModel: m };
    }
    // z.ai / GLM
    if (lower.startsWith('glm-')) {
        return { provider: 'zai', targetModel: m };
    }
    // Opencode Zen (zen- prefix or zen: prefix)
    if (lower.startsWith('zen-') || lower.startsWith('zen:')) {
        return { provider: 'zen', targetModel: m };
    }
    // Opencode Go (opencode- prefix) — uses opencode.ai/zen/go/v1
    if (lower.startsWith('opencode-') || lower.startsWith('opencode:') ||
        lower.startsWith('go-') || lower.startsWith('go:')) {
        return { provider: 'opencode', targetModel: m };
    }
    // Local providers (use `provider:model` or `provider-model` syntax)
    if (lower.startsWith('lmstudio:') || lower.startsWith('lmstudio-')) {
        return { provider: 'lmstudio', targetModel: m };
    }
    if (lower.startsWith('llamacpp:') || lower.startsWith('llamacpp-')) {
        return { provider: 'llamacpp', targetModel: m };
    }
    if (lower.startsWith('unsloth:') || lower.startsWith('unsloth-')) {
        return { provider: 'unsloth', targetModel: m };
    }
    // MiniMax (M3, M2.7, M2.5, also accepts the case "MiniMax-M3" etc.)
    if (lower.startsWith('minimax-') || lower === 'minimax') {
        return { provider: 'minimax', targetModel: m };
    }
    // Everything else → antigravity (handles gemini, claude, ag-*, etc.)
    return { provider: 'antigravity', targetModel: m };
}

app.post(['/v1/chat/completions', '/chat/completions'], async (req, res) => {
    try {
        const { model, messages, stream, max_tokens, temperature, top_p, top_k, stop, tools, tool_choice, frequency_penalty, presence_penalty, n, seed, user, response_format } = req.body;
        if (!messages) {
            return res.status(400).json({ error: { message: 'messages is required' } });
        }
        const { provider, targetModel } = detectProvider(model);
        console.log(`[route] ${model} -> ${provider} (${targetModel})`);

        const params = { model: targetModel, messages, stream, max_tokens, temperature, top_p, top_k, stop, tools, tool_choice, frequency_penalty, presence_penalty, n, seed, user, response_format };

        if (provider === 'antigravity') {
            await antigravity.chatCompletion(params, res);
        } else if (provider === 'codex') {
            await codex.chatCompletion(params, res);
        } else if (provider === 'minimax') {
            await minimax.chatCompletion(params, res);
        } else {
            // zai, zen, lmstudio, llamacpp, unsloth
            await openaiCompat.chatCompletion({ provider, ...params }, res);
        }
    } catch (error) {
        console.error('Proxy error:', error);
        // Map known error categories to proper HTTP status codes.
        const msg = error.message || String(error);
        let status = 500;
        // Auth-related: 401 (client must re-authenticate).
        if (/auth unavailable|not signed in|not logged in|no api key|no credentials|unauthorized|authentication|sign[- ]?in/i.test(msg)) {
            status = 401;
        } else if (/rate|limit|429|quota/i.test(msg)) {
            status = 429;
        } else if (/not supported|not found|unknown model|invalid|400/i.test(msg)) {
            status = 400;
        }
        if (res.headersSent) {
            // Streaming already started — emit an SSE error chunk and close.
            try {
                res.write(`data: ${JSON.stringify({ error: { message: msg } })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
            } catch (e) { }
        } else {
            res.status(status).json({ error: { message: msg, type: error.name || 'proxy_error' } });
        }
    }
});

const PORT = parseInt(process.env.PORT || '6767', 10);
app.listen(PORT, () => {
    console.log(`\n🍜 Cursor Instant Noodle listening on port ${PORT}\n`);
});
