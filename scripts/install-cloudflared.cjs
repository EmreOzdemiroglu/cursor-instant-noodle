// Postinstall helper: download the cloudflared binary so the public tunnel works.
// IMPORTANT: this must NEVER fail the install. If anything goes wrong
// (offline, rate-limited, npm git mode not extracting scripts/ yet,
// corporate proxy, anything), the CLI + local proxy still work fine —
// only `cursor-noodle tunnel` (public URL) is unavailable. Users can
// also `brew install cloudflared` or download it manually later.
(async () => {
    try {
        await main();
    } catch (e) {
        console.log(`cloudflared: postinstall skipped (${e && e.message ? e.message : 'unknown'}).`);
        console.log('  Local proxy still works. For a public tunnel, install cloudflared manually:');
        console.log('    brew install cloudflared   |   apt install cloudflared   |   https://github.com/cloudflare/cloudflared/releases');
        // Exit 0 on purpose: postinstall failures must never break `npm install`.
        process.exit(0);
    }
})();

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { platform, arch } = process;

const BINARY_NAME = 'cloudflared';
// Use process.cwd() instead of __dirname: under `npm install -g github:...`
// npm clones into a temp dir and may not have extracted scripts/ before
// postinstall runs, so __dirname would point at a missing directory.
const TARGET_DIR = process.cwd();
const TARGET_PATH = path.join(TARGET_DIR, BINARY_NAME);

async function main() {
    // Already installed in the package dir -> nothing to do.
    if (fs.existsSync(TARGET_PATH)) return;

    // If cloudflared is already on PATH, don't bother downloading.
    try {
        execSync(`command -v ${BINARY_NAME} >/dev/null 2>&1`, { stdio: 'ignore' });
        return;
    } catch (e) { /* not on PATH, continue */ }

    const url = getDownloadUrl();
    if (!url) {
        console.log('cloudflared: unsupported platform, skipping (local proxy still works).');
        return;
    }
    console.log('cloudflared: downloading for tunnel support...');

    if (url.endsWith('.tgz')) {
        const tarPath = path.join(TARGET_DIR, 'cloudflared.tgz');
        await downloadFile(url, tarPath);
        execSync(`tar -xzf ${tarPath} -C ${TARGET_DIR}`);
        fs.unlinkSync(tarPath);
    } else {
        await downloadFile(url, TARGET_PATH);
    }
    if (platform !== 'win32' && fs.existsSync(TARGET_PATH)) {
        fs.chmodSync(TARGET_PATH, 0o755);
    }
    console.log('cloudflared: installed (public tunnel ready).');
}

function getDownloadUrl() {
    const archMap = { 'x64': 'amd64', 'arm64': 'arm64', 'ia32': '386' };
    const mappedArch = archMap[arch];
    if (!mappedArch) return null;
    if (platform === 'darwin') return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${mappedArch}.tgz`;
    if (platform === 'linux') return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${mappedArch}`;
    if (platform === 'win32') return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-${mappedArch}.exe`;
    return null;
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const get = (u) => https.get(u, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                response.resume();
                get(response.headers.location);
                return;
            }
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
                response.resume();
                return;
            }
            response.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
        get(url);
    });
}
