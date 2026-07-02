const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const CODEX_AUTH_PATH = process.env.CODEX_AUTH_PATH ||
    path.join(os.homedir(), '.codex', 'auth.json');

let cachedAuth = {
    access: null,
    refresh: null,
    idToken: null,
    accountId: null,
    expires: 0,
};

function readAuthFile() {
    try {
        if (!fs.existsSync(CODEX_AUTH_PATH)) return null;
        const data = JSON.parse(fs.readFileSync(CODEX_AUTH_PATH, 'utf8'));
        if (data.auth_mode !== 'chatgpt' || !data.tokens) return null;
        return data.tokens;
    } catch (e) {
        return null;
    }
}

function refreshAccessToken(refreshToken) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: '__REMOVED_CODEX_OAUTH_CLIENT_ID__',  // Codex CLI client_id
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
                        // Persist new tokens
                        const authFile = readAuthFile();
                        if (authFile) {
                            const updated = {
                                ...JSON.parse(fs.readFileSync(CODEX_AUTH_PATH, 'utf8')),
                                tokens: {
                                    ...authFile,
                                    access_token: parsed.access_token || authFile.access_token,
                                    id_token: parsed.id_token || authFile.id_token,
                                    refresh_token: parsed.refresh_token || refreshToken,
                                },
                                last_refresh: new Date().toISOString(),
                            };
                            try { fs.writeFileSync(CODEX_AUTH_PATH, JSON.stringify(updated, null, 2)); } catch (e) { }
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

async function getAuth() {
    // Check if we have a valid cached access token (1 hour validity)
    if (cachedAuth.access && cachedAuth.expires > Date.now() + 5 * 60 * 1000) {
        return cachedAuth;
    }
    const tokens = readAuthFile();
    if (!tokens || !tokens.access_token) {
        return null;
    }

    // Try the cached access token first
    cachedAuth.access = tokens.access_token;
    cachedAuth.idToken = tokens.id_token;
    cachedAuth.accountId = tokens.account_id;
    cachedAuth.refresh = tokens.refresh_token;
    cachedAuth.expires = Date.now() + 50 * 60 * 1000;  // assume 50 min

    // If we have a refresh token, proactively refresh in the background
    if (tokens.refresh_token) {
        refreshAccessToken(tokens.refresh_token)
            .then(parsed => {
                cachedAuth.access = parsed.access_token || cachedAuth.access;
                cachedAuth.idToken = parsed.id_token || cachedAuth.idToken;
                cachedAuth.refresh = parsed.refresh_token || cachedAuth.refresh;
                cachedAuth.expires = Date.now() + 50 * 60 * 1000;
                console.log('[codex] Refreshed access token');
            })
            .catch(e => console.error('[codex] background refresh failed:', e.message));
    }

    return cachedAuth;
}

module.exports = { getAuth };
