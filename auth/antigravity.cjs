const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

// Antigravity OAuth constants (from opencode-antigravity-auth plugin)
const ANTIGRAVITY_CLIENT_ID = "__REMOVED_GOOGLE_OAUTH_CLIENT_ID__";
const ANTIGRAVITY_CLIENT_SECRET = "__REMOVED_GOOGLE_OAUTH_CLIENT_SECRET__";

let cachedToken = {
    access: null,
    refresh: null,
    projectId: null,
    expires: 0,
    email: null,
};

function readRefreshTokenFromConfig() {
    const configPath = path.join(os.homedir(), '.config', 'opencode', 'antigravity-accounts.json');
    try {
        if (fs.existsSync(configPath)) {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (data.accounts && data.accounts.length > 0) {
                const activeIdx = data.activeIndex || 0;
                const account = data.accounts[activeIdx];
                if (account && account.enabled && account.refreshToken) {
                    return {
                        refreshToken: account.refreshToken,
                        projectId: null,
                        email: account.email,
                    };
                }
            }
        }
    } catch (e) { }
    return null;
}

function readRefreshTokenFromCliProxy() {
    const dir = path.join(os.homedir(), '.cli-proxy-api');
    try {
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir).filter(f => f.startsWith('antigravity-') && f.endsWith('.json'));
            for (const file of files) {
                const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
                if (data.refresh_token && !data.disabled) {
                    return {
                        refreshToken: data.refresh_token,
                        projectId: data.project_id || null,
                        email: data.email,
                    };
                }
            }
        }
    } catch (e) { }
    return null;
}

function readRefreshToken() {
    return readRefreshTokenFromConfig() || readRefreshTokenFromCliProxy();
}

function exchangeRefreshToken(refreshToken) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: ANTIGRAVITY_CLIENT_ID,
            client_secret: ANTIGRAVITY_CLIENT_SECRET,
        }).toString();
        const req = https.request('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Parse error: ' + data)); }
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
                metadata: { ideType: 'ANTIGRAVITY', platform: 'MACOS', pluginType: 'GEMINI' }
            });
            const req = https.request(`${endpoint}/v1internal:loadCodeAssist`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'antigravity/2.0.6 darwin/arm64',
                    'Client-Metadata': JSON.stringify({ ideType: 'ANTIGRAVITY', platform: 'MACOS', pluginType: 'GEMINI' }),
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

async function getAuth() {
    if (cachedToken.access && cachedToken.expires > Date.now() + 5 * 60 * 1000) {
        return cachedToken;
    }
    const stored = readRefreshToken();
    if (!stored) return null;

    console.log(`[antigravity] Refreshing token for ${stored.email}...`);
    try {
        const tokenData = await exchangeRefreshToken(stored.refreshToken);
        cachedToken.access = tokenData.access_token;
        cachedToken.expires = Date.now() + (tokenData.expires_in * 1000);
        cachedToken.refresh = tokenData.refresh_token || stored.refreshToken;
        if (!stored.projectId) {
            const projectId = await loadCodeAssist(tokenData.access_token);
            cachedToken.projectId = projectId || 'rising-fact-p41fc';
        } else {
            cachedToken.projectId = stored.projectId;
        }
        cachedToken.email = stored.email;
        console.log(`[antigravity] Got fresh access token, project: ${cachedToken.projectId}`);
        return cachedToken;
    } catch (e) {
        console.error('[antigravity] Token refresh failed:', e.message);
        return null;
    }
}

module.exports = { getAuth };
