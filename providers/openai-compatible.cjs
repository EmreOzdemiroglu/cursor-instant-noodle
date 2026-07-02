const http = require('http');
const https = require('https');
const { URL } = require('url');
const { pickKey, pickEntry, parseKeys, recordResult } = require('../lib/keypool.cjs');

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

// Return every API key the provider can use, in priority order. Excludes
// the opencode-coding-plan auth-loader fallback (that's a single source
// resolved lazily). Used to drive sticky failover across all accounts.
function listEnvKeysForProvider(cfg) {
    const out = [];
    const seen = new Set();
    for (const envVar of [cfg.apiKeyEnv, cfg.apiKeyEnvFallback]) {
        if (!envVar) continue;
        for (const k of parseKeys(envVar)) {
            if (seen.has(k)) continue;
            seen.add(k);
            out.push({ envVar, value: k });
        }
    }
    return out;
}

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

function isFailoverStatus(code) {
    return code === 401 || code === 403 || code === 429 || code >= 500;
}

function classifyError(code, body) {
    if (isFailoverStatus(code)) return 'failover';
    return 'user';
}

async function chatCompletion(params, res) {
    const { provider, model, messages, stream, max_tokens, temperature, top_p, stop, tools, tool_choice, frequency_penalty, presence_penalty, n, seed, user, response_format } = params;
    const cfg = PROVIDERS[provider];
    if (!cfg) {
        res.status(400).json({ error: { message: `Unknown provider: ${provider}` } });
        return;
    }
    const targetModel = cfg.stripPrefix
        ? model.replace(new RegExp(`^${provider}:`), '').replace(new RegExp(`^${provider}-`), '')
        : model;

    // Build the list of (envVar, index, key) candidates in priority order.
    // For OAuth-style or single-key providers, the auth loader supplies a
    // single key (handled as a 1-item list with envVar=null).
    const candidates = [];
    const envKeys = listEnvKeysForProvider(cfg);
    for (const ek of envKeys) {
        const indices = parseKeys(ek.envVar).map((v, idx) => ({ v, idx })).filter(x => x.v === ek.value);
        const idx = indices.length ? indices[0].idx : 0;
        candidates.push({ envVar: ek.envVar, index: idx, apiKey: ek.value });
    }
    if (candidates.length === 0 && cfg.apiKeyDefault) {
        candidates.push({ envVar: null, index: 0, apiKey: cfg.apiKeyDefault });
    }
    if (candidates.length === 0 && cfg.authLoader) {
        const a = await cfg.authLoader();
        if (a && a.apiKey) {
            candidates.push({ envVar: null, index: 0, apiKey: a.apiKey });
            if (a.baseURL) cfg.baseURL = a.baseURL;
        }
    }
    if (candidates.length === 0) {
        res.status(401).json({ error: { message: `No API key for provider "${provider}". Set ${cfg.apiKeyEnv} env var.` } });
        return;
    }

    // Re-order by sticky-failover preference: pickEntry returns the highest-
    // priority healthy key. We re-run pickEntry for each envVar to know
    // which index is "preferred" for that envVar.
    const preferredIndex = {};
    for (const c of candidates) {
        if (c.envVar == null) continue;
        if (preferredIndex[c.envVar] !== undefined) continue;
        const entry = pickEntry(c.envVar);
        if (entry) preferredIndex[c.envVar] = entry.index;
    }
    candidates.sort((a, b) => {
        const ai = a.envVar == null ? -1 : (preferredIndex[a.envVar] === a.index ? 0 : 1);
        const bi = b.envVar == null ? -1 : (preferredIndex[b.envVar] === b.index ? 0 : 1);
        return ai - bi;
    });

    const buildBody = () => {
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
        return body;
    };

    const url = `${cfg.baseURL}/chat/completions`;

    // Sticky failover across all candidates. We only send streaming headers
    // (or any response) after a candidate succeeds, so the caller never
    // sees intermediate errors. Only the last failure is surfaced.
    const errors = [];
    for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cand.apiKey}`,
            'Accept': stream ? 'text/event-stream' : 'application/json',
        };
        const body = JSON.stringify(buildBody());
        let remoteRes;
        try {
            remoteRes = await forwardRequest({ url, method: 'POST', headers, body });
        } catch (e) {
            errors.push(`key ${i + 1}: ${e.message}`);
            continue;
        }
        const code = remoteRes.statusCode;
        if (code >= 200 && code < 300) {
            // Success — mark this key healthy and stream the response.
            if (cand.envVar) recordResult(cand.envVar, cand.index, true);
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
            return;
        }
        // Drain error body so the socket can close, then mark + try next.
        let errBody = '';
        await new Promise(resolve => {
            remoteRes.on('data', c => errBody += c);
            remoteRes.on('end', resolve);
            remoteRes.on('error', resolve);
        });
        errors.push(`key ${i + 1}: ${provider} ${code}: ${errBody.substring(0, 200)}`);
        if (cand.envVar) {
            recordResult(cand.envVar, cand.index, false, classifyError(code, errBody));
        }
        if (!isFailoverStatus(code)) break; // 400/404 etc. won't be helped by another key
    }
    // All candidates failed.
    const last = errors[errors.length - 1] || `${provider} auth unavailable`;
    const codeMatch = last.match(/\b(\d{3})\b/);
    const code = codeMatch ? parseInt(codeMatch[1], 10) : 500;
    const finalStatus = code === 429 ? 429 : (code === 401 || code === 403 ? 401 : 500);
    if (stream) {
        res.write(`data: ${JSON.stringify({ error: { message: last } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    } else {
        res.status(finalStatus).json({ error: { message: last } });
    }
}

module.exports = { chatCompletion, PROVIDERS };
