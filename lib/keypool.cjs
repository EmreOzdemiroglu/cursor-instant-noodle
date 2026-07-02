// lib/keypool.cjs — round-robin API key pool
//
// Lets you configure multiple API keys per provider (e.g. two Opencode Zen
// accounts, three z.ai keys) and have the proxy cycle through them so rate
// limits and quotas are spread across accounts.
//
// Usage:
//   const { pickKey, listKeys } = require('./lib/keypool.cjs');
//   const key = pickKey('OPENCODE_ZEN_API_KEY');  // returns one key per call
//   const all = listKeys('OPENCODE_ZEN_API_KEY'); // returns the full array
//
// Storage: keys are stored as comma-separated values in the .env file
// (e.g. `OPENCODE_ZEN_API_KEY=sk-abc,sk-def,sk-ghi`). Splitting happens here
// so that the rest of the code can keep reading single values.
//
// Round-robin is per-process, per-env-var name. Multiple concurrent requests
// pick different keys because Node's event loop interleaves them.

const _counters = {};

function parseKeys(envVar) {
    const raw = process.env[envVar];
    if (!raw) return [];
    return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

function pickKey(envVar) {
    const keys = parseKeys(envVar);
    if (keys.length === 0) return null;
    if (keys.length === 1) return keys[0];
    if (_counters[envVar] === undefined) _counters[envVar] = -1;
    const i = _counters[envVar] = (_counters[envVar] + 1) % keys.length;
    return keys[i];
}

function listKeys(envVar) {
    return parseKeys(envVar);
}

// Set the env var from a list. Returns the new comma-separated value.
function setKeys(envVar, keys) {
    const cleaned = keys.map(s => String(s).trim()).filter(Boolean);
    if (cleaned.length === 0) {
        delete process.env[envVar];
        return '';
    }
    const joined = cleaned.join(',');
    process.env[envVar] = joined;
    return joined;
}

module.exports = { pickKey, listKeys, setKeys, parseKeys };