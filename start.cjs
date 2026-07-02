const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { DATA_DIR, ENV_FILE, ensureEnvFile } = require('./lib/paths.cjs');

// Tiny .env loader (no dependency) — reads from the persistent data dir.
function loadEnv() {
    ensureEnvFile();
    if (!fs.existsSync(ENV_FILE)) return;
    const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        // ~/.cursor-noodle/.env is the authoritative source.
        process.env[key] = value;
    }
}
loadEnv();

console.log('--- Starting Cursor Instant Noodle & Persistent Tunnel ---');

const port = process.env.PORT || '6767';

let proxy = null;
let plannedRestart = false;
function spawnProxy() {
    proxy = spawn('node', ['proxy.cjs'], {
        stdio: 'inherit',
        cwd: __dirname,
        env: { ...process.env, PORT: port, NOODLE_API_KEY: process.env.NOODLE_API_KEY || '' },
    });
    proxy.on('close', (code) => {
        if (shuttingDown) return;
        if (plannedRestart) return;
        console.log(`Proxy exited with code ${code}; restarting in 1s...`);
        setTimeout(spawnProxy, 1000);
    });
}
spawnProxy();

function resolveCloudflared() {
    const bundled = path.join(__dirname, 'cloudflared');
    if (fs.existsSync(bundled) && fs.accessSync(bundled, fs.constants.X_OK) === undefined) return bundled;
    try {
        const { execSync } = require('child_process');
        const onPath = execSync('command -v cloudflared', { encoding: 'utf8' }).trim();
        if (onPath) return onPath;
    } catch (e) { /* not on PATH */ }
    return null;
}

const cloudflaredPath = resolveCloudflared();
let tunnel = null;
let urlFound = false;

function spawnTunnel() {
    if (!cloudflaredPath) return;
    urlFound = false;
    tunnel = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`], {
        cwd: __dirname,
    });
    tunnel.stderr.on('data', (data) => {
        const output = data.toString();
        const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (urlMatch && !urlFound) {
            urlFound = true;
            console.log('\n🍜 Cursor Instant Noodle is LIVE!');
            console.log('--------------------------------------------------');
            console.log(`Base URL for Cursor: ${urlMatch[0]}/v1`);
            console.log(`Local URL:           http://localhost:${port}/v1`);
            console.log('--------------------------------------------------\n');
        }
    });
    tunnel.on('close', (code) => {
        if (shuttingDown) return;
        console.log(`Tunnel exited with code ${code}`);
    });
}

if (cloudflaredPath) {
    spawnTunnel();
} else {
    console.log('cloudflared not found — public tunnel disabled.');
    console.log('Local proxy still works at http://localhost:' + port + '/v1');
    console.log('Install cloudflared for a public URL:  brew install cloudflared  |  https://github.com/cloudflare/cloudflared/releases');
}

// ─── .env hot reload ─────────────────────────────────────────────────────
// Watch the data dir for changes to .env and reload the proxy in place.
// We deliberately do NOT recycle the cloudflared tunnel on .env changes —
// rotating the public URL every time someone tweaks a key would break
// Cursor mid-edit. The URL only changes when the proxy process itself is
// restarted (`cursor-noodle restart`, crash recovery, daemon startup).
function restartProxy(reason) {
    console.log(`🍜 ${reason} — reloading proxy in place (tunnel stays up)`);
    plannedRestart = true;
    try { proxy && proxy.kill('SIGTERM'); } catch (e) {}
    // Wait for the proxy to exit, then respawn it. The tunnel stays up
    // throughout (its only purpose is forwarding to localhost:PORT).
    let elapsed = 0;
    const wait = setInterval(() => {
        elapsed += 50;
        const proxyDead = !proxy || proxy.exitCode != null;
        if (proxyDead || elapsed > 3000) {
            clearInterval(wait);
            spawnProxy();
            setTimeout(() => { plannedRestart = false; }, 500);
        }
    }, 50);
}

// Cheap content hash so we can collapse bursts of writes during setup
// (e.g. OAuth login appends refresh/access/id/email tokens one by one
// with network IO between them) into a single reload. Comments and
// blank lines are ignored so cosmetic edits (uncommenting an example
// key) don’t trigger a reload on their own.
function hashEnvFile(p) {
    try {
        const c = fs.readFileSync(p, 'utf8');
        const meaningful = c.split('\n').filter(l => !/^\s*(#|$)/.test(l)).join('\n');
        let h = 5381;
        for (let i = 0; i < meaningful.length; i++) h = ((h << 5) + h + meaningful.charCodeAt(i)) | 0;
        return h + ':' + meaningful.length;
    } catch (e) { return '0'; }
}

function startEnvWatcher() {
    if (!fs.existsSync(ENV_FILE)) return;
    let lastMtime = fs.statSync(ENV_FILE).mtimeMs;
    let lastHash = hashEnvFile(ENV_FILE);
    let pending = null;

    const trigger = (reason) => {
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
            pending = null;
            try {
                const mtime = fs.statSync(ENV_FILE).mtimeMs;
                const hash = hashEnvFile(ENV_FILE);
                if (mtime === lastMtime) return;
                if (hash === lastHash) { lastMtime = mtime; return; }
                lastMtime = mtime;
                lastHash = hash;
                loadEnv();
                restartProxy(reason);
            } catch (e) { /* file gone or unreadable; ignore */ }
        }, 800);
    };

    // fs.watch can miss events on some editors; combine with mtime polling
    // every 2s as a safety net.
    try {
        fs.watch(ENV_FILE, { persistent: false }, () => trigger('.env changed'));
    } catch (e) {
        // Fall back to watching the parent dir (handles atomic save: editor
        // writes to a temp file then renames it over the real .env).
        try {
            fs.watch(DATA_DIR, { persistent: false }, (_evt, name) => {
                if (name === path.basename(ENV_FILE)) trigger('.env changed');
            });
        } catch (e2) { /* best-effort; mtime poll below still catches it */ }
    }
    setInterval(() => trigger('.env updated'), 2000);
}
startEnvWatcher();

// ─── shutdown ────────────────────────────────────────────────────────────
let shuttingDown = false;
const shutdown = () => {
    shuttingDown = true;
    console.log('\nShutting down...');
    try { proxy && proxy.kill(); } catch (e) {}
    try { tunnel && tunnel.kill(); } catch (e) {}
    process.exit();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);