const http = require('http');
const https = require('https');
const { URL } = require('url');
const { pickKey } = require('../lib/keypool.cjs');

// Provider configurations
// apiKey defaults to null — the actual key (or comma-separated round-robin
// list) is resolved at request time via lib/keypool.cjs so different requests
// can use different accounts.
const PROVIDERS = {
    'zai': {
        baseURL: process.env.ZAI_BASE_URL || 'https://api.z.ai/api/coding/paas/v4',
        apiKeyEnv: 'ZAI_API_KEY',
        stripPrefix: false,
        authLoader: require('../auth/zai.cjs').getAuth,
    },
    'zen': {
        baseURL: process.env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1',
        apiKeyEnv: 'OPENCODE_ZEN_API_KEY',
        stripPrefix: true,  // strip "zen-" prefix before sending
    },
    'opencode': {
        // Opencode Go — uses OPENCODE_GO_API_KEY (falls back to ZEN key)
        baseURL: process.env.OPENCODE_GO_BASE_URL || 'https://opencode.ai/zen/go/v1',
        apiKeyEnv: 'OPENCODE_GO_API_KEY',
        apiKeyEnvFallback: 'OPENCODE_ZEN_API_KEY',
        stripPrefix: true,  // strip "opencode-" prefix before sending
    },
    'lmstudio': {
        baseURL: process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1',
        apiKeyEnv: 'LMSTUDIO_API_KEY',
        apiKeyDefault: 'lmstudio',
        stripPrefix: true,
    },
    'llamacpp': {
        baseURL: process.env.LLAMACPP_BASE_URL || 'http://localhost:8080/v1',
        apiKeyEnv: 'LLAMACPP_API_KEY',
        apiKeyDefault: 'llamacpp',
        stripPrefix: true,
    },
    'unsloth': {
        baseURL: process.env.UNSLOTH_BASE_URL || 'http://localhost:11434/v1',
        apiKeyEnv: 'UNSLOTH_API_KEY',
        apiKeyDefault: 'unsloth',
        stripPrefix: true,
    },
};

async function resolveAuth(providerName) {
    const cfg = PROVIDERS[providerName];
    if (!cfg) throw new Error(`Unknown provider: ${providerName}`);
    let apiKey = pickKey(cfg.apiKeyEnv);
    if (!apiKey && cfg.apiKeyEnvFallback) apiKey = pickKey(cfg.apiKeyEnvFallback);
    if (!apiKey && cfg.apiKeyDefault) apiKey = cfg.apiKeyDefault;
    // Some providers (zai, minimax) may have an additional fallback that
    // reads from opencode auth.json. Delegate to it only if env has no key.
    if (!apiKey && cfg.authLoader) {
        const a = await cfg.authLoader();
        if (a && a.apiKey) apiKey = a.apiKey;
        if (a && a.baseURL) cfg.baseURL = a.baseURL;
    }
    if (!apiKey) throw new Error(`No API key for provider "${providerName}". Set ${cfg.apiKeyEnv} env var.`);
    return { baseURL: cfg.baseURL, apiKey, stripPrefix: cfg.stripPrefix };
}

function forwardRequest({ url, method, headers, body }) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const lib = u.protocol === 'https:' ? https : http;
        const req = lib.request({
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            method,
            headers: { ...headers, 'Content-Length': Buffer.byteLength(body || '') },
        }, (res) => {
            resolve(res);
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function chatCompletion({ provider, model, messages, stream, max_tokens, temperature, top_p, stop, tools, tool_choice, frequency_penalty, presence_penalty, n, seed, user, response_format }, res) {
    const cfg = await resolveAuth(provider);
    const targetModel = cfg.stripPrefix ? model.replace(new RegExp(`^${provider}:`), '').replace(new RegExp(`^${provider}-`), '') : model;

    const body = { model: targetModel, messages, stream: !!stream };
    if (max_tokens) body.max_tokens = max_tokens;
    if (temperature !== undefined) body.temperature = temperature;
    if (top_p !== undefined) body.top_p = top_p;
    if (stop) body.stop = stop;
    if (tools) body.tools = tools;
    if (tool_choice) body.tool_choice = tool_choice;
    if (frequency_penalty !== undefined) body.frequency_penalty = frequency_penalty;
    if (presence_penalty !== undefined) body.presence_penalty = presence_penalty;
    if (n) body.n = n;
    if (seed) body.seed = seed;
    if (user) body.user = user;
    if (response_format) body.response_format = response_format;

    const url = `${cfg.baseURL}/chat/completions`;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Accept': stream ? 'text/event-stream' : 'application/json',
    };

    try {
        const remoteRes = await forwardRequest({ url, method: 'POST', headers, body: JSON.stringify(body) });
        if (remoteRes.statusCode < 200 || remoteRes.statusCode >= 300) {
            let errBody = '';
            remoteRes.on('data', c => errBody += c);
            remoteRes.on('end', () => {
                const errMsg = `${provider} ${remoteRes.statusCode}: ${errBody.substring(0, 400)}`;
                if (stream) {
                    res.write(`data: ${JSON.stringify({ error: { message: errMsg, code: remoteRes.statusCode } })}\n\n`);
                    res.write('data: [DONE]\n\n');
                    res.end();
                } else {
                    res.status(remoteRes.statusCode).json({ error: { message: errMsg, code: remoteRes.statusCode, raw: errBody.substring(0, 1000) } });
                }
            });
            return;
        }
        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            remoteRes.pipe(res);
            remoteRes.on('end', () => res.end());
        } else {
            let data = '';
            remoteRes.on('data', c => data += c);
            remoteRes.on('end', () => {
                try { res.json(JSON.parse(data)); }
                catch (e) { res.status(500).json({ error: { message: `Bad response from ${provider}`, raw: data.substring(0, 500) } }); }
            });
        }
    } catch (e) {
        if (stream) {
            res.write(`data: ${JSON.stringify({ error: { message: e.message } })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
        } else {
            res.status(502).json({ error: { message: e.message } });
        }
    }
}

module.exports = { chatCompletion, PROVIDERS };
