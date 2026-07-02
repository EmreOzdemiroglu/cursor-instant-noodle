const https = require('https');
const { parseKeys } = require('../lib/keypool.cjs');

// Env-only Antigravity auth. No opencode/agy auth-file fallback: setup owns
// the state. Account selection is sticky and provider-level failover decides
// when to try the next account.
//
// Like Codex, we keep access tokens in memory only. Writing back to .env on
// every refresh would race with the .env watcher and cause proxy reloads
// mid-request. The refresh token in .env is durable; the access token is
// short-lived and re-derived from the refresh token on the next request
// after a restart.
const authCache = new Map();

function clean(v) { return v && v !== '_' ? v : ''; }

function splitStoredRefresh(value) {
    const raw = String(value || '').trim();
    if (!raw) return { refreshToken: '', projectId: null };
    const [refreshToken, projectId] = raw.split('|');
    return { refreshToken, projectId: projectId || null };
}

function listAuthEntries() {
    const refreshValues = parseKeys('ANTIGRAVITY_REFRESH_TOKEN');
    const emails = parseKeys('ANTIGRAVITY_EMAIL');
    const projects = parseKeys('ANTIGRAVITY_PROJECT_ID');
    return refreshValues.map((value, index) => {
        const { refreshToken, projectId: embeddedProjectId } = splitStoredRefresh(value);
        return {
            refreshToken,
            projectId: clean(projects[index]) || embeddedProjectId || null,
            email: clean(emails[index]) || `account ${index + 1}`,
            source: 'cursor-noodle-env',
            envIndex: index,
        };
    }).filter(t => t.refreshToken);
}

function exchangeRefreshToken(refreshToken) {
    const clientId = process.env.ANTIGRAVITY_CLIENT_ID;
    const clientSecret = process.env.ANTIGRAVITY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        return Promise.reject(new Error('Antigravity OAuth client missing. Run `cursor-noodle setup` and sign in with Antigravity.'));
    }
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
        }).toString();
        const req = https.request('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) { reject(new Error('Parse error: ' + data)); }
                } else {
                    reject(new Error(`Token refresh failed (${res.statusCode}): ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function loadCodeAssist(accessToken) {
    return new Promise((resolve) => {
        const endpoints = [
            'https://cloudcode-pa.googleapis.com',
            'https://daily-cloudcode-pa.sandbox.googleapis.com',
            'https://autopush-cloudcode-pa.sandbox.googleapis.com',
        ];
        const tryEndpoint = (i) => {
            if (i >= endpoints.length) { resolve(null); return; }
            const endpoint = endpoints[i];
            const body = JSON.stringify({
                metadata: { ideType: 'ANTIGRAVITY', platform: process.platform === 'win32' ? 'WINDOWS' : 'MACOS', pluginType: 'GEMINI' }
            });
            const req = https.request(`${endpoint}/v1internal:loadCodeAssist`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'antigravity/2.0.6 darwin/arm64',
                    'Client-Metadata': JSON.stringify({ ideType: 'ANTIGRAVITY', platform: process.platform === 'win32' ? 'WINDOWS' : 'MACOS', pluginType: 'GEMINI' }),
                },
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(data);
                            const project = typeof parsed.cloudaicompanionProject === 'string'
                                ? parsed.cloudaicompanionProject
                                : parsed.cloudaicompanionProject?.id;
                            resolve(project);
                        } catch (e) { tryEndpoint(i + 1); }
                    } else { tryEndpoint(i + 1); }
                });
            });
            req.on('error', () => tryEndpoint(i + 1));
            req.write(body);
            req.end();
        };
        tryEndpoint(0);
    });
}

async function getAuthForEntry(stored) {
    if (!stored || !stored.refreshToken) return null;
    const cached = authCache.get(stored.refreshToken);
    if (cached && cached.expires > Date.now() + 5 * 60 * 1000) return cached;

    console.log(`[antigravity] Refreshing token for ${stored.email}...`);
    try {
        const tokenData = await exchangeRefreshToken(stored.refreshToken);
        const projectId = stored.projectId || await loadCodeAssist(tokenData.access_token) || 'rising-fact-p41fc';
        const auth = {
            access: tokenData.access_token,
            expires: Date.now() + (tokenData.expires_in * 1000),
            refresh: tokenData.refresh_token || stored.refreshToken,
            projectId,
            email: stored.email,
            index: stored.envIndex,
            source: stored.source,
        };
        // Re-key the cache if the server rotated the refresh token. We do
        // NOT write the rotated refresh back to .env: that would race with
        // the .env watcher and cause mid-request proxy reloads.
        if (tokenData.refresh_token && tokenData.refresh_token !== stored.refreshToken) {
            authCache.delete(stored.refreshToken);
            authCache.set(auth.refresh, auth);
        } else {
            authCache.set(stored.refreshToken, auth);
        }
        console.log(`[antigravity] Got fresh access token, project: ${auth.projectId}`);
        return auth;
    } catch (e) {
        console.error('[antigravity] Token refresh failed:', e.message);
        return null;
    }
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
