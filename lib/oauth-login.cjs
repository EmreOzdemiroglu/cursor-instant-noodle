'use strict';

const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');

const CODEX_ISSUER = 'https://auth.openai.com';
const CODEX_TOKEN_URL = `${CODEX_ISSUER}/oauth/token`;

const CODEX_CLIENT_SOURCES = [
    'https://raw.githubusercontent.com/openai/codex/main/codex-cli/src/cli.tsx',
    'https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/plugin/openai/codex.ts',
    'https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/plugin/codex.ts',
];
const ANTIGRAVITY_CONSTANTS_URL = 'https://raw.githubusercontent.com/NoeFabris/opencode-antigravity-auth/main/src/constants.ts';
const ANTIGRAVITY_REDIRECT_URI = 'http://localhost:51121/oauth-callback';
const ANTIGRAVITY_SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs',
];
const ANTIGRAVITY_DEFAULT_PROJECT_ID = 'rising-fact-p41fc';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function base64Url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomString(bytes = 32) {
    return base64Url(crypto.randomBytes(bytes));
}

function codeChallenge(verifier) {
    return base64Url(crypto.createHash('sha256').update(verifier).digest());
}

function decodeJwtPayload(token) {
    try {
        const part = String(token || '').split('.')[1];
        if (!part) return null;
        return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    } catch (e) {
        return null;
    }
}

function openBrowser(url) {
    const cmd = process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
            ? 'cmd'
            : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    try {
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
        child.unref();
        return true;
    } catch (e) {
        return false;
    }
}

async function postJson(url, body, headers = {}) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) {
        const err = new Error(json?.error_description || json?.error?.message || json?.error || text || `HTTP ${res.status}`);
        err.status = res.status;
        err.body = json || text;
        throw err;
    }
    return json;
}

async function postForm(url, form, headers = {}) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
        body: new URLSearchParams(form).toString(),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) {
        const err = new Error(json?.error_description || json?.error?.message || json?.error || text || `HTTP ${res.status}`);
        err.status = res.status;
        err.body = json || text;
        throw err;
    }
    return json;
}

async function fetchCodexOAuthClient() {
    if (process.env.CODEX_CLIENT_ID) return { clientId: process.env.CODEX_CLIENT_ID };
    for (const source of CODEX_CLIENT_SOURCES) {
        try {
            const res = await fetch(source, { headers: { Accept: 'text/plain' } });
            if (!res.ok) continue;
            const text = await res.text();
            const id = text.match(/client_id\s*:\s*"([^"]+)"/)?.[1]
                || text.match(/CLIENT_ID\s*=\s*"([^"]+)"/)?.[1]
                || text.match(/clientId\s*=\s*"([^"]+)"/)?.[1];
            if (id) return { clientId: id, source };
        } catch (e) {}
    }
    throw new Error('Could not fetch Codex OAuth client_id. Check your network or set CODEX_CLIENT_ID in ~/.cursor-noodle/.env.');
}

async function codexDeviceLogin({ onCode } = {}) {
    const { clientId } = await fetchCodexOAuthClient();
    const device = await postJson(`${CODEX_ISSUER}/api/accounts/deviceauth/usercode`, {
        client_id: clientId,
    });

    const userCode = device.user_code;
    const deviceAuthId = device.device_auth_id;
    const interval = Math.max(3, Number(device.interval || 5));
    if (!userCode || !deviceAuthId) throw new Error('OpenAI device-code response was incomplete.');

    const verifyUrl = `${CODEX_ISSUER}/codex/device`;
    if (onCode) onCode({ verifyUrl, userCode });
    openBrowser(verifyUrl);

    const started = Date.now();
    let authCode = null;
    while (Date.now() - started < 15 * 60 * 1000) {
        await sleep(interval * 1000);
        try {
            const poll = await postJson(`${CODEX_ISSUER}/api/accounts/deviceauth/token`, {
                device_auth_id: deviceAuthId,
                user_code: userCode,
            });
            authCode = poll;
            break;
        } catch (e) {
            if (e.status === 403 || e.status === 404) continue;
            throw e;
        }
    }
    if (!authCode) throw new Error('Codex login timed out after 15 minutes.');

    const authorizationCode = authCode.authorization_code;
    const verifier = authCode.code_verifier;
    if (!authorizationCode || !verifier) throw new Error('OpenAI device auth response was incomplete.');

    const tokens = await postForm(CODEX_TOKEN_URL, {
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: `${CODEX_ISSUER}/deviceauth/callback`,
        client_id: clientId,
        code_verifier: verifier,
    });

    if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error('Codex token exchange did not return both access_token and refresh_token.');
    }

    const payload = decodeJwtPayload(tokens.id_token || tokens.access_token) || {};
    return {
        provider: 'codex',
        clientId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token || '',
        accountId: tokens.account_id || payload.account_id || payload.sub || '',
        email: payload.email || '',
    };
}

async function fetchAntigravityOAuthClient() {
    const res = await fetch(ANTIGRAVITY_CONSTANTS_URL, { headers: { Accept: 'text/plain' } });
    if (!res.ok) throw new Error(`Could not fetch Antigravity OAuth config (${res.status}).`);
    const text = await res.text();
    const id = text.match(/ANTIGRAVITY_CLIENT_ID\s*=\s*"([^"]+)"/)?.[1];
    const secret = text.match(/ANTIGRAVITY_CLIENT_SECRET\s*=\s*"([^"]+)"/)?.[1];
    if (!id || !secret) throw new Error('Could not parse Antigravity OAuth client from upstream plugin.');
    return { clientId: id, clientSecret: secret };
}

function waitForAntigravityCallback() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            try {
                const url = new URL(req.url, ANTIGRAVITY_REDIRECT_URI);
                if (url.pathname !== '/oauth-callback') {
                    res.writeHead(404).end('Not found');
                    return;
                }
                const code = url.searchParams.get('code');
                const state = url.searchParams.get('state');
                const error = url.searchParams.get('error');
                if (error) throw new Error(error);
                if (!code || !state) throw new Error('Callback missing code/state.');
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<h2>Cursor Instant Noodle</h2><p>Antigravity login complete. You can close this tab.</p>');
                server.close(() => resolve({ code, state }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(e.message);
                server.close(() => reject(e));
            }
        });
        server.once('error', reject);
        server.listen(51121);
    });
}

async function fetchAntigravityProjectId(accessToken) {
    const endpoints = [
        'https://cloudcode-pa.googleapis.com',
        'https://daily-cloudcode-pa.sandbox.googleapis.com',
        'https://autopush-cloudcode-pa.sandbox.googleapis.com',
    ];
    for (const endpoint of endpoints) {
        try {
            const res = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'google-api-nodejs-client/9.15.1',
                    'Client-Metadata': JSON.stringify({
                        ideType: 'ANTIGRAVITY',
                        platform: process.platform === 'win32' ? 'WINDOWS' : 'MACOS',
                        pluginType: 'GEMINI',
                    }),
                },
                body: JSON.stringify({
                    metadata: {
                        ideType: 'ANTIGRAVITY',
                        platform: process.platform === 'win32' ? 'WINDOWS' : 'MACOS',
                        pluginType: 'GEMINI',
                    },
                }),
            });
            if (!res.ok) continue;
            const data = await res.json();
            const project = typeof data.cloudaicompanionProject === 'string'
                ? data.cloudaicompanionProject
                : data.cloudaicompanionProject?.id;
            if (project) return project;
        } catch (e) {}
    }
    return ANTIGRAVITY_DEFAULT_PROJECT_ID;
}

async function antigravityGoogleLogin({ onUrl } = {}) {
    const { clientId, clientSecret } = await fetchAntigravityOAuthClient();
    const verifier = randomString(64);
    const state = randomString(24);
    const callbackPromise = waitForAntigravityCallback();

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', ANTIGRAVITY_REDIRECT_URI);
    authUrl.searchParams.set('scope', ANTIGRAVITY_SCOPES.join(' '));
    authUrl.searchParams.set('code_challenge', codeChallenge(verifier));
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    const urlString = authUrl.toString();
    if (onUrl) onUrl(urlString);
    openBrowser(urlString);

    const callback = await callbackPromise;
    if (callback.state !== state) throw new Error('OAuth state mismatch. Login cancelled for safety.');

    const tokens = await postForm('https://oauth2.googleapis.com/token', {
        client_id: clientId,
        client_secret: clientSecret,
        code: callback.code,
        grant_type: 'authorization_code',
        redirect_uri: ANTIGRAVITY_REDIRECT_URI,
        code_verifier: verifier,
    }, {
        Accept: '*/*',
        'User-Agent': 'google-api-nodejs-client/9.15.1',
    });

    if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error('Antigravity token exchange did not return both access_token and refresh_token.');
    }

    let email = '';
    try {
        const info = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (info.ok) email = (await info.json()).email || '';
    } catch (e) {}

    const projectId = await fetchAntigravityProjectId(tokens.access_token);
    return {
        provider: 'antigravity',
        clientId,
        clientSecret,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        email,
        projectId,
    };
}

module.exports = {
    codexDeviceLogin,
    antigravityGoogleLogin,
    fetchCodexOAuthClient,
    fetchAntigravityOAuthClient,
};
