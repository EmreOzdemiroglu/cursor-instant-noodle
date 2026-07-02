// Central path resolution for cursor-noodle.
//
// We keep TWO directories distinct:
//   - PACKAGE_DIR : where the code lives (read-only, replaced on upgrade)
//                   e.g. /opt/homebrew/lib/node_modules/cursor-instant-noodle
//   - DATA_DIR    : where user state lives (persists across upgrades)
//                   e.g. ~/.cursor-noodle
//
// Putting .env / pid / log in DATA_DIR means `npm install -g` upgrades never
// wipe the user's API keys, and never require sudo to write.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PACKAGE_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.CURSOR_NOODLE_DATA_DIR
    ? path.resolve(process.env.CURSOR_NOODLE_DATA_DIR)
    : path.join(os.homedir(), '.cursor-noodle');

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        // 0o700: only the owner can read/write/cd into it. The dir holds
        // refresh tokens and API keys, so it must not be world-readable.
        fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    } else {
        // Tighten an existing dir that was created by an older version.
        try { fs.chmodSync(DATA_DIR, 0o700); } catch (e) { /* best-effort */ }
    }
}

// Seed DATA_DIR/.env from the package's .env.example on first run.
// If the user already has a .env (in DATA_DIR or the old package-dir location),
// we never overwrite it.
function ensureEnvFile() {
    ensureDataDir();
    const target = path.join(DATA_DIR, '.env');
    if (fs.existsSync(target)) return target;

    // Migrate from the old location (package-dir/.env) if present (pre-0.0.2 installs).
    const legacy = path.join(PACKAGE_DIR, '.env');
    if (fs.existsSync(legacy)) {
        try {
            fs.copyFileSync(target, legacy);
            // Credentials must not be world-readable.
            try { fs.chmodSync(target, 0o600); } catch (e) {}
            return target;
        } catch (e) { /* fall through to seed */ }
    }

    // Seed from the bundled example.
    const example = path.join(PACKAGE_DIR, '.env.example');
    if (fs.existsSync(example)) {
        try {
            fs.copyFileSync(example, target);
            try { fs.chmodSync(target, 0o600); } catch (e) {}
        } catch (e) { /* ignore — user can create it later */ }
    }
    return target;
}

module.exports = {
    PACKAGE_DIR,
    DATA_DIR,
    PID_FILE: path.join(DATA_DIR, '.cursor-noodle.pid'),
    LOG_FILE: path.join(DATA_DIR, '.cursor-noodle.log'),
    ENV_FILE: path.join(DATA_DIR, '.env'),
    ENV_EXAMPLE: path.join(PACKAGE_DIR, '.env.example'),
    ensureDataDir,
    ensureEnvFile,
};
