const fs = require('fs');
const https = require('https');
const { parseKeys } = require('../lib/keypool.cjs');
const { ENV_FILE } = require('../lib/paths.cjs');

// Env-only Antigravity auth. No opencode/agy auth-file fallback: setup owns
// the state. Account selection is sticky and provider-level failover decides
// when to try the next account.
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

function exchangeRefreshToken(refreshToken, envIndex = null) {
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
                        const parsed = JSON.parse(data);
                        if (envIndex != null && parsed.refresh_token) {
                            updateEnvList('ANTIGRAVITY_REFRESH_TOKEN', envIndex, parsed.refresh_token);
                        }
                        resolve(parsed);
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
        const tokenData = await exchangeRefreshToken(stored.refreshToken, stored.envIndex);
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
        authCache.set(auth.refresh || stored.refreshToken, auth);
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
