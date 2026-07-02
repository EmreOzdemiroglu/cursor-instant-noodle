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
        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        // Only set if not already in process.env (env wins)
        if (process.env[key] === undefined) process.env[key] = value;
    }
}
loadEnv();

console.log('--- Starting Cursor Instant Noodle & Persistent Tunnel ---');

const port = process.env.PORT || '6767';
const proxy = spawn('node', ['proxy.cjs'], {
    stdio: 'inherit',
    cwd: __dirname,
    env: { ...process.env, PORT: port },
});

// Resolve cloudflared: prefer the bundled binary, fall back to PATH,
// and disable the tunnel gracefully if it's not available at all.
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
if (cloudflaredPath) {
    tunnel = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`], {
        cwd: __dirname,
    });
} else {
    console.log('cloudflared not found — public tunnel disabled.');
    console.log('Local proxy still works at http://localhost:' + port + '/v1');
    console.log('Install cloudflared for a public URL:  brew install cloudflared  |  https://github.com/cloudflare/cloudflared/releases');
}

let urlFound = false;
if (tunnel) {
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
        console.log(`Tunnel exited with code ${code}`);
        process.exit(code);
    });
}
proxy.on('close', (code) => {
    console.log(`Proxy exited with code ${code}`);
    if (tunnel) tunnel.kill();
    process.exit(code);
});
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    proxy.kill();
    tunnel.kill();
    process.exit();
});
