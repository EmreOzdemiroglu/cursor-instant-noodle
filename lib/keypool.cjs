// lib/keypool.cjs — sticky-failover API key pool
//
// All providers (API keys AND OAuth) use the same selection policy now:
// pick key 0, then on auth/quota/rate failure silently try key 1, then 2,
// and so on. Each call only surfaces an error to the caller after every
// account has been tried.
//
// Why sticky-failover instead of round-robin:
//   - Round-robin is fine for stateless API keys, but it punishes users
//     who have one good account and one bad/expired one: 50% of requests
//     hit the bad account. Sticky-failover keeps good accounts on
//     account 0 and only falls over when account 0 actually breaks.
//   - OAuth backends cache per-account state, so per-request round-robin
//     can break that cache. Sticky-failover preserves cache affinity.
//   - API-key providers and OAuth use the same mechanism now, so the
//     failure semantics are uniform across the whole proxy.
//
// Per-key state (per env var name):
//   - _state[envVar][index] = { unhealthyUntil: ms-timestamp }
//   - If `unhealthyUntil` is in the future, that key is skipped during
//     the current request. After the cooldown passes, the key is retried.

const FAILURE_COOLDOWN_MS = 60 * 1000;

const _state = {};

function _bucket(envVar) {
    if (!_state[envVar]) _state[envVar] = {};
    return _state[envVar];
}

function _isHealthy(envVar, index) {
    const b = _state[envVar];
    if (!b) return true;
    const s = b[index];
    if (!s) return true;
    return s.unhealthyUntil <= Date.now();
}

function _markUnhealthy(envVar, index) {
    const b = _bucket(envVar);
    b[index] = { unhealthyUntil: Date.now() + FAILURE_COOLDOWN_MS };
}

function _markHealthy(envVar, index) {
    const b = _bucket(envVar);
    delete b[index];
}

function parseKeys(envVar) {
    const raw = process.env[envVar];
    if (!raw) return [];
    return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

function pickEntry(envVar) {
    const keys = parseKeys(envVar);
    if (keys.length === 0) return null;
    if (keys.length === 1) return { value: keys[0], index: 0, total: 1 };
    // Sticky: prefer key 0 unless it's marked unhealthy. Then key 1, etc.
    for (let i = 0; i < keys.length; i++) {
        if (_isHealthy(envVar, i)) return { value: keys[i], index: i, total: keys.length };
    }
    // All keys are unhealthy — try key 0 again, it's the freshest state.
    return { value: keys[0], index: 0, total: keys.length };
}

function pickKey(envVar) {
    const entry = pickEntry(envVar);
    return entry ? entry.value : null;
}

function listKeys(envVar) {
    return parseKeys(envVar);
}

// Mark the result of a request that used `index`. If it failed for a
// reason that should trigger failover (auth/quota/rate), mark unhealthy.
function recordResult(envVar, index, success, kind = null) {
    if (success) {
        _markHealthy(envVar, index);
        return;
    }
    if (/auth|forbid|quota|rate|limit|exhaust|unauthor|payment|insufficient/i.test(String(kind || ''))) {
        _markUnhealthy(envVar, index);
    }
}

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

module.exports = {
    pickKey,
    pickEntry,
    listKeys,
    setKeys,
    parseKeys,
    recordResult,
    // For tests / status display.
    _isHealthy,
};
