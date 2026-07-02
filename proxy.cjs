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
const { MODELS, advertisedModels } = require('./lib/models.cjs');


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
    res.json({ object: 'list', data: advertisedModels() });
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
