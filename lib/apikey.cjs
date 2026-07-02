'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { ENV_FILE } = require('./paths.cjs');

const API_KEY_PREFIX = 'instant-noodle-';

function generateApiKey() {
    // 8 url-safe chars (≈47 bits). Plenty for an unauthenticated
    // local-proxy scenario; long enough to be unguessable on the
    // public trycloudflare.com URL.
    const raw = crypto.randomBytes(8).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return API_KEY_PREFIX + raw;
}

function readApiKey() {
    const v = process.env.NOODLE_API_KEY;
    if (v && v.startsWith(API_KEY_PREFIX)) return v;
    return null;
}

function isValidApiKey(provided) {
    const expected = readApiKey();
    if (!expected) return true; // no key configured -> allow all (dev mode)
    if (!provided) return false;
    // Constant-time compare to avoid timing oracles.
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function ensureApiKey() {
    if (readApiKey()) return readApiKey();
    const key = generateApiKey();
    if (!fs.existsSync(ENV_FILE)) {
        try { fs.writeFileSync(ENV_FILE, `NOODLE_API_KEY=${key}\n`, { mode: 0o600 }); } catch (e) {}
    } else {
        try {
            let content = fs.readFileSync(ENV_FILE, 'utf8');
            const re = /^#?\s*NOODLE_API_KEY=.*$/m;
            const line = `NOODLE_API_KEY=${key}`;
            if (re.test(content)) content = content.replace(re, line);
            else content = content.trimEnd() + '\n' + line + '\n';
            fs.writeFileSync(ENV_FILE, content, { mode: 0o600 });
        } catch (e) {}
    }
    process.env.NOODLE_API_KEY = key;
    return key;
}

function resetApiKey() {
    return ensureApiKey(); // generate and overwrite
}

function extractBearer(authorizationHeader) {
    if (!authorizationHeader) return null;
    const m = String(authorizationHeader).match(/^Bearer\s+(.+)$/i);
    return m ? m[1].trim() : null;
}

module.exports = {
    API_KEY_PREFIX,
    generateApiKey,
    readApiKey,
    isValidApiKey,
    ensureApiKey,
    resetApiKey,
    extractBearer,
};
