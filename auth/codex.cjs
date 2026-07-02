const fs = require('fs');
const https = require('https');
const { parseKeys } = require('../lib/keypool.cjs');
const { ENV_FILE } = require('../lib/paths.cjs');

// Env-only Codex auth. No Codex CLI auth.json fallback: setup owns the state.
// Account selection is sticky: use account 0 until a provider-level failure,
// then silently fail over to account 1, etc. This preserves backend cache
// affinity better than request-by-request round-robin.
const authCache = new Map();

function updateEnvList(envVar, index, value) {
    if (index == null || index < 0 || !value) return;
    let content = '';
    try { content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : ''; } catch (e) { return; }
    const re = new RegExp(`^${envVar}=(.*)$`, 'm');
    const match = content.match(re);
    const values = match ? match[1].split(',').map(s => s.trim()) : [];
    while (values.length <= index) values.push('_');
    values[index] = value;
    const line = `${envVar}=${values.join(',')}`;
    content = match ? content.replace(re, line) : content + `\n${line}\n`;
    try {
        fs.writeFileSync(ENV_FILE, content);
        process.env[envVar] = values.join(',');
    } catch (e) {}
}

function clean(v) { return v && v !== '_' ? v : ''; }

function listAuthEntries() {
    const refreshTokens = parseKeys('CODEX_REFRESH_TOKEN');
    const accessTokens = parseKeys('CODEX_ACCESS_TOKEN');
    const idTokens = parseKeys('CODEX_ID_TOKEN');
    const accountIds = parseKeys('CODEX_ACCOUNT_ID');
    const emails = parseKeys('CODEX_EMAIL');
    return refreshTokens.map((refresh, index) => ({
        access_token: clean(accessTokens[index]),
        refresh_token: refresh,
        id_token: clean(idTokens[index]),
        account_id: clean(accountIds[index]),
        email: clean(emails[index]),
        source: 'cursor-noodle-env',
        envIndex: index,
    })).filter(t => t.refresh_token || t.access_token);
}

function refreshAccessToken(refreshToken, envIndex = null) {
    const clientId = process.env.CODEX_CLIENT_ID;
    if (!clientId) {
        return Promise.reject(new Error('Codex OAuth client_id missing. Run `cursor-noodle setup` and sign in with Codex.'));
    }
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            scope: 'openid profile email offline_access',
        }).toString();
        const req = https.request('https://auth.openai.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsed = JSON.parse(data);
                        if (envIndex != null) {
                            updateEnvList('CODEX_ACCESS_TOKEN', envIndex, parsed.access_token);
                            updateEnvList('CODEX_ID_TOKEN', envIndex, parsed.id_token);
                            updateEnvList('CODEX_ACCOUNT_ID', envIndex, parsed.account_id);
                            updateEnvList('CODEX_REFRESH_TOKEN', envIndex, parsed.refresh_token || refreshToken);
                        }
                        resolve(parsed);
                    } catch (e) { reject(new Error('Parse error: ' + data)); }
                } else {
                    reject(new Error(`Codex token refresh failed (${res.statusCode}): ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function getAuthForEntry(tokens) {
    if (!tokens || (!tokens.access_token && !tokens.refresh_token)) return null;
    const cacheKey = tokens.refresh_token || tokens.access_token;
    const cached = authCache.get(cacheKey);
    if (cached && cached.expires > Date.now() + 5 * 60 * 1000) return cached;

    if (!tokens.access_token && tokens.refresh_token) {
        try {
            const parsed = await refreshAccessToken(tokens.refresh_token, tokens.envIndex);
            const auth = {
                access: parsed.access_token,
                idToken: parsed.id_token || tokens.id_token,
                accountId: parsed.account_id || tokens.account_id,
                refresh: parsed.refresh_token || tokens.refresh_token,
                email: tokens.email,
                index: tokens.envIndex,
                source: tokens.source,
                expires: Date.now() + 50 * 60 * 1000,
            };
            authCache.set(auth.refresh || cacheKey, auth);
            return auth;
        } catch (e) {
            console.error('[codex] refresh failed:', e.message);
            return null;
        }
    }

    const auth = {
        access: tokens.access_token,
        idToken: tokens.id_token,
        accountId: tokens.account_id,
        refresh: tokens.refresh_token,
        email: tokens.email,
        index: tokens.envIndex,
        source: tokens.source,
        expires: Date.now() + 50 * 60 * 1000,
    };
    authCache.set(cacheKey, auth);

    if (tokens.refresh_token) {
        refreshAccessToken(tokens.refresh_token, tokens.envIndex)
            .then(parsed => {
                auth.access = parsed.access_token || auth.access;
                auth.idToken = parsed.id_token || auth.idToken;
                auth.accountId = parsed.account_id || auth.accountId;
                auth.refresh = parsed.refresh_token || auth.refresh;
                auth.expires = Date.now() + 50 * 60 * 1000;
                authCache.set(auth.refresh || cacheKey, auth);
                console.log('[codex] Refreshed access token');
            })
            .catch(e => console.error('[codex] background refresh failed:', e.message));
    }

    return auth;
}

async function getAuth() {
    return getAuthForEntry(listAuthEntries()[0]);
}

async function getAuthCandidates() {
    const out = [];
    for (const entry of listAuthEntries()) {
        const auth = await getAuthForEntry(entry);
        if (auth) out.push(auth);
    }
    return out;
}

module.exports = { getAuth, getAuthCandidates };
