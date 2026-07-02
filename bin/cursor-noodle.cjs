#!/usr/bin/env node
// cursor-noodle — Cursor on an instant-noodle budget 🍜
//
// Commands:
//   start       Start the proxy + tunnel in the background
//   stop        Stop the running proxy
//   restart     Stop then start
//   status      Show running state and tunnel URL
//   setup       Interactive setup wizard
//   logs        Tail the proxy log
//   models      List all available models
//   tunnel      Show the current public tunnel URL
//   help        Show help

'use strict';

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Command, Option } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer').default || require('inquirer');
const ora = require('ora').default || require('ora');
const boxen = require('boxen').default || require('boxen');
const log = {
    success: 'OK',
    error: 'ERROR',
    warning: 'WARN',
    info: 'INFO',
};

const {
    PACKAGE_DIR,
    DATA_DIR,
    PID_FILE,
    LOG_FILE,
    ENV_FILE,
    ENV_EXAMPLE,
    ensureDataDir,
    ensureEnvFile,
} = require('../lib/paths.cjs');

function printBanner() {
    const banner = boxen(
        chalk.bold.cyan('🍜  Cursor Instant Noodle  🍜\n') +
        chalk.dim('Antigravity · Codex · z.ai · Opencode · Local'),
        {
            padding: 1,
            margin: { top: 1, bottom: 1, left: 0, right: 0 },
            borderStyle: 'round',
            borderColor: 'cyan',
            align: 'center',
        }
    );
    console.log(banner);
}

// ─── PID / process management ───────────────────────────────
function isRunning() {
    if (!fs.existsSync(PID_FILE)) return false;
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return pid;
    } catch (e) {
        // Stale pid file
        try { fs.unlinkSync(PID_FILE); } catch (e2) { }
        return false;
    }
}

function readTunnelFromLog() {
    try {
        const log = fs.readFileSync(LOG_FILE, 'utf8');
        const match = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\/v1/);
        return match ? match[0] : null;
    } catch (e) {
        return null;
    }
}

function start() {
    ensureDataDir();
    if (isRunning()) {
        console.log(log.warning + ' ' + chalk.yellow('Already running. Use `cursor-noodle restart` to reload.'));
        return status();
    }
    if (!fs.existsSync(path.join(PACKAGE_DIR, 'node_modules'))) {
        console.log(log.error + ' ' + chalk.red('node_modules not found. Run `npm install` first.'));
        process.exit(1);
    }
    fs.writeFileSync(LOG_FILE, '');

    const child = spawn('node', [path.join(PACKAGE_DIR, 'start.cjs')], {
        cwd: PACKAGE_DIR,
        detached: true,
        stdio: ['ignore', fs.openSync(LOG_FILE, 'a'), fs.openSync(LOG_FILE, 'a')],
        env: { ...process.env, PORT: String(PORT()) },
    });
    fs.writeFileSync(PID_FILE, String(child.pid));
    child.unref();

    console.log(log.success + ' ' + chalk.green(`Started in background (pid ${child.pid})`));
    console.log(chalk.dim(`   Log:  ${LOG_FILE}`));
    console.log(chalk.dim(`   URL:  http://localhost:${PORT()}/v1`));
    console.log();

    // Wait for tunnel to come up
    const spinner = ora({ text: 'Waiting for tunnel...', color: 'cyan' }).start();
    const startedAt = Date.now();
    const tick = setInterval(() => {
        const t = readTunnelFromLog();
        if (t) {
            clearInterval(tick);
            spinner.stop();
            console.log(log.success + ' ' + chalk.green('Tunnel ready'));
            console.log();
            console.log(boxen(
                chalk.bold('Public URL\n') + chalk.cyan(t),
                { padding: 1, borderStyle: 'round', borderColor: 'green', align: 'center' }
            ));
            console.log();
        } else if (Date.now() - startedAt > 30000) {
            clearInterval(tick);
            spinner.stop();
            console.log(log.warning + ' ' + chalk.yellow('Tunnel did not come up in 30s. Check logs with `cursor-noodle logs`.'));
        }
    }, 500);
}

function stop() {
    const pid = isRunning();
    if (!pid) {
        console.log(log.info + ' ' + chalk.dim('Not running.'));
        return;
    }
    const spinner = ora({ text: `Stopping pid ${pid}...`, color: 'red' }).start();
    try {
        process.kill(-pid, 'SIGTERM');
        try { process.kill(pid, 'SIGTERM'); } catch (e) { }
    } catch (e) { }
    const startTime = Date.now();
    const wait = setInterval(() => {
        try { process.kill(pid, 0); } catch (e) {
            clearInterval(wait);
            try { fs.unlinkSync(PID_FILE); } catch (e2) { }
            spinner.stop();
            console.log(log.success + ' ' + chalk.green('Stopped'));
            return;
        }
        if (Date.now() - startTime > 5000) {
            clearInterval(wait);
            try { process.kill(-pid, 'SIGKILL'); } catch (e) { }
            try { process.kill(pid, 'SIGKILL'); } catch (e) { }
            try { fs.unlinkSync(PID_FILE); } catch (e2) { }
            spinner.stop();
            console.log(log.warning + ' ' + chalk.yellow('Force-killed'));
        }
    }, 200);
}

// ─── Provider-connection detection ────────────────────────────────────────
// Each check is fast (file exists + parse) and runs without loading the proxy.
const fs2 = require('fs');
const os2 = require('os');
const path2 = require('path');

function fileExists(p) { try { return fs2.existsSync(p); } catch (e) { return false; } }
function readJson(p) { try { return JSON.parse(fs2.readFileSync(p, 'utf8')); } catch (e) { return null; } }

function checkCodex() {
    const p = process.env.CODEX_AUTH_PATH || path2.join(os2.homedir(), '.codex', 'auth.json');
    if (!fileExists(p)) return { ok: false, detail: '~/.codex/auth.json not found' };
    const j = readJson(p);
    if (!j) return { ok: false, detail: '~/.codex/auth.json unreadable' };
    // Codex auth has two shapes: {tokens: {access_token, refresh_token}} (chatgpt mode)
    // or top-level {access_token, refresh_token} (legacy/api-key mode).
    const t = j.tokens || j;
    if (!t.access_token && !t.refresh_token) return { ok: false, detail: 'no tokens in ~/.codex/auth.json' };
    let email = null;
    if (t.id_token) {
        try {
            const payload = JSON.parse(Buffer.from(t.id_token.split('.')[1] || 'e30=', 'base64').toString());
            email = payload.email;
        } catch (e) {}
    }
    return { ok: true, detail: email || t.account_id || 'token present' };
}

function checkAntigravity() {
    const home = os2.homedir();
    const candidates = [
        path2.join(home, '.config', 'opencode', 'antigravity-accounts.json'),
        path2.join(home, '.local', 'share', 'opencode', 'antigravity-accounts.json'),
    ];
    // Per-account files
    const dirs = [
        path2.join(home, '.config', 'opencode'),
        path2.join(home, '.local', 'share', 'opencode'),
    ];
    for (const d of dirs) {
        try {
            if (fs2.existsSync(d)) {
                for (const f of fs2.readdirSync(d)) {
                    if (f.startsWith('antigravity-') && f.endsWith('.json')) candidates.push(path2.join(d, f));
                }
            }
        } catch (e) {}
    }
    for (const p of candidates) {
        if (!fileExists(p)) continue;
        const j = readJson(p);
        if (!j) continue;
        if (j.accounts && Array.isArray(j.accounts) && j.accounts.length > 0) {
            const active = j.accounts[j.activeIndex || 0];
            if (active && active.refreshToken) return { ok: true, detail: active.email || `${j.accounts.length} account(s)` };
        }
        if (j.refresh_token) return { ok: true, detail: j.email || 'refresh token' };
    }
    return { ok: false, detail: 'no antigravity credentials found' };
}

function checkOpencode() {
    const authPath = path2.join(os2.homedir(), '.local', 'share', 'opencode', 'auth.json');
    const j = readJson(authPath);
    if (!j) return { ok: false, detail: '~/.local/share/opencode/auth.json not found' };
    const env = process.env;
    const hasCodingPlan = !!j['opencode'];
    const hasZen = !!env.OPENCODE_ZEN_API_KEY || !!j['opencode-zen'];
    const hasGo = !!env.OPENCODE_GO_API_KEY || hasCodingPlan;
    if (!hasZen && !hasGo && !hasCodingPlan) return { ok: false, detail: 'no zen/go/coding-plan keys' };
    const labels = [];
    if (hasZen) labels.push('zen');
    if (hasGo) labels.push('go');
    if (hasCodingPlan) labels.push('coding-plan');
    return { ok: true, detail: labels.join('+') };
}

function checkZai() {
    if (process.env.ZAI_API_KEY) return { ok: true, detail: 'ZAI_API_KEY env' };
    const authPath = path2.join(os2.homedir(), '.local', 'share', 'opencode', 'auth.json');
    const j = readJson(authPath);
    if (j && j['z.ai'] && j['z.ai'].key) return { ok: true, detail: 'z.ai key in opencode auth' };
    return { ok: false, detail: 'ZAI_API_KEY missing' };
}

function checkMinimax() {
    if (process.env.MINIMAX_API_KEY) return { ok: true, detail: 'MINIMAX_API_KEY env' };
    const authPath = path2.join(os2.homedir(), '.local', 'share', 'opencode', 'auth.json');
    const j = readJson(authPath);
    if (j && j['minimax'] && j['minimax'].key) return { ok: true, detail: 'minimax key in opencode auth' };
    return { ok: false, detail: 'MINIMAX_API_KEY missing' };
}

// Async local-server probe — runs after status prints the other providers.
// Returns the first server that accepts a TCP connection within 150ms.
async function probeLocalAsync() {
    const net = require('net');
    const ports = [
        { port: 1234, name: 'LM Studio' },
        { port: 8080, name: 'llama.cpp' },
        { port: 11434, name: 'Ollama' },
    ];
    for (const { port, name } of ports) {
        const reachable = await new Promise(resolve => {
            const sock = new net.Socket();
            let done = false;
            const finish = (v) => { if (!done) { done = true; resolve(v); } };
            sock.setTimeout(150);
            sock.once('connect', () => { sock.destroy(); finish(true); });
            sock.once('timeout', () => { sock.destroy(); finish(false); });
            sock.once('error', () => finish(false));
            sock.connect(port, '127.0.0.1');
        });
        if (reachable) return { ok: true, detail: `${name} on :${port}` };
    }
    return { ok: false, detail: 'no server on :1234/:8080/:11434' };
}

// Read .env file for env vars that aren't yet in process.env (CLI doesn't load .env)
function loadEnvFile(envPath) {
    if (!fileExists(envPath)) return;
    try {
        for (const line of fs2.readFileSync(envPath, 'utf8').split('\n')) {
            const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+)\s*$/);
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
        }
    } catch (e) {}
}

function status() {
    printBanner();
    // Load env from data dir so OPENCODE_ZEN_API_KEY etc. are visible to our checks.
    loadEnvFile(ENV_FILE);

    const pid = isRunning();
    const port = PORT();

    if (!pid) {
        console.log(`  ${chalk.bold('Status')}  ${chalk.red('stopped')}`);
        console.log(`  ${chalk.bold('Port')}    ${port}`);
        console.log();
        console.log(`  Run ${chalk.cyan('cursor-noodle start')} to start the proxy.`);
        console.log();
        return;
    }

    const tunnel = readTunnelFromLog();
    const header = [
        [chalk.bold('Status'), chalk.green('running')],
        [chalk.bold('PID'), String(pid)],
        [chalk.bold('Port'), String(port)],
        [chalk.bold('Log'), chalk.dim(LOG_FILE)],
        [chalk.bold('Local'), chalk.cyan(`http://localhost:${port}/v1`)],
        [chalk.bold('Tunnel'), tunnel ? chalk.cyan(tunnel) : chalk.dim('(waiting…)')],
    ];
    console.log(header.map(([k, v]) => `  ${k.padEnd(8)} ${v}`).join('\n'));
    console.log();

    // ── Provider connection status ────────────────────────────
    console.log(chalk.bold('Providers'));
    const providers = [
        { key: 'antigravity', label: 'Antigravity', check: checkAntigravity },
        { key: 'codex',       label: 'Codex',       check: checkCodex },
        { key: 'zai',         label: 'z.ai (GLM)',  check: checkZai },
        { key: 'minimax',     label: 'minimax',      check: checkMinimax },
        { key: 'opencode',    label: 'Opencode',    check: checkOpencode },
    ];
    const providerStatus = {};
    for (const p of providers) {
        const r = p.check();
        providerStatus[p.key] = r;
        const tag = r.ok ? chalk.green('OK  ') : chalk.red('MISS');
        console.log(`  ${tag}  ${p.label.padEnd(14)} ${chalk.dim(r.detail)}`);
    }
    // Local server probe runs async so it doesn't block status output.
    probeLocalAsync().then(r => {
        providerStatus.local = r;
        const tag = r.ok ? chalk.green('OK  ') : chalk.yellow('----');
        console.log(`  ${tag}  ${'Local'.padEnd(14)} ${chalk.dim(r.detail)}`);
    });
    console.log();

    // ── Live model counts per provider (from running proxy) ────
    fetch(`http://localhost:${port}/v1/models`).then(r => r.ok ? r.json() : null).then(data => {
        if (!data || !data.data) {
            console.log(`  ${chalk.yellow('(could not fetch model list)')}`);
            return;
        }
        // Bucket by owned_by (provider key from proxy.cjs). Local variants
        // (lmstudio/llamacpp/unsloth) collapse under 'local'.
        const buckets = {};
        const localBucket = 'local';
        for (const m of data.data) {
            const b = m.owned_by;
            const bucket = (b === 'lmstudio' || b === 'llamacpp' || b === 'unsloth') ? localBucket : b;
            buckets[bucket] = (buckets[bucket] || 0) + 1;
        }
        // Map proxy provider keys to status-check keys for the OK/miss tag.
        const okMap = {
            'antigravity': providerStatus.antigravity?.ok,
            'codex':       providerStatus.codex?.ok,
            'zai':         providerStatus.zai?.ok,
            'minimax':     providerStatus.minimax?.ok,
            'zen':         providerStatus.opencode?.ok,
            'opencode':    providerStatus.opencode?.ok,
            'local':       providerStatus.local?.ok,
        };
        const order = ['antigravity', 'codex', 'zai', 'minimax', 'zen', 'opencode', 'local'];
        const seen = new Set();
        for (const k of order) {
            if (buckets[k] != null) {
                const ok = okMap[k];
                const tag = ok ? chalk.green('OK  ') : (ok === false ? chalk.yellow('keys') : chalk.dim('??   '));
                console.log(`  ${tag}  ${k.padEnd(14)} ${buckets[k]} model(s)`);
                seen.add(k);
            }
        }
        for (const k of Object.keys(buckets)) {
            if (!seen.has(k)) console.log(`  ${chalk.dim('     ')}  ${k.padEnd(14)} ${buckets[k]} model(s)`);
        }
        console.log();
        console.log(chalk.dim(`  Total: ${data.data.length} model(s) advertised · cursor-noodle models`));
    }).catch(err => {
        console.log(`  ${chalk.yellow('(could not fetch model list: ' + err.message + ')')}`);
    });
}

function logs() {
    if (!fs.existsSync(LOG_FILE)) {
        console.log(log.warning + ' ' + chalk.yellow('No log file yet — start the proxy first.'));
        return;
    }
    console.log(chalk.dim(`Tailing ${LOG_FILE} — Ctrl+C to exit`));
    console.log(chalk.dim('─'.repeat(60)));
    const tail = spawn('tail', ['-f', '-n', '50', LOG_FILE], { stdio: 'inherit' });
    process.on('SIGINT', () => { tail.kill(); process.exit(0); });
}

function tunnel() {
    if (!fs.existsSync(LOG_FILE)) {
        console.log(log.warning + ' ' + chalk.yellow('No log file yet — start the proxy first.'));
        return;
    }
    const t = readTunnelFromLog();
    if (t) {
        console.log(t);
    } else {
        console.log(log.warning + ' ' + chalk.yellow('No tunnel URL in log yet.'));
    }
}

async function models() {
    printBanner();
    const spinner = ora({ text: 'Fetching models...', color: 'cyan' }).start();
    try {
        const out = execSync(`curl -s --max-time 5 'http://localhost:${PORT()}/v1/models'`, { encoding: 'utf8' });
        const data = JSON.parse(out);
        const grouped = {};
        for (const m of data.data) {
            const p = m.owned_by || 'unknown';
            if (!grouped[p]) grouped[p] = [];
            grouped[p].push(m.id);
        }
        spinner.stop();
        for (const provider of Object.keys(grouped).sort()) {
            console.log(chalk.bold.magenta(`\n  ${provider.toUpperCase()}`));
            for (const id of grouped[provider].sort()) {
                console.log(`    - ${id}`);
            }
        }
    } catch (e) {
        spinner.stop();
        console.log(log.error + ' ' + chalk.red('Could not fetch models — is the proxy running?'));
        console.log(chalk.dim('  Try: cursor-noodle start'));
    }
    console.log();
}

// ─── Interactive setup ─────────────────────────────────────
// Each provider has: id, label, envVar (or null for OAuth), type 'oauth'|'apikey'|'local',
// helper text shown in the menu, and notes for the key prompt.
const PROVIDERS = [
    { id: 'antigravity', label: 'Antigravity',  envVar: null,              type: 'oauth',   desc: 'Claude / Gemini / GPT-OSS via Google OAuth',     models: '8 models' },
    { id: 'codex',       label: 'Codex',         envVar: null,              type: 'oauth',   desc: 'GPT-5.5 / 5.4 via ChatGPT Plus/Pro',             models: '11 models' },
    { id: 'zen',         label: 'Opencode Zen', envVar: 'OPENCODE_ZEN_API_KEY', type: 'apikey', desc: 'gpt-5.5, claude-opus, deepseek, north, mimo',  models: '17 models' },
    { id: 'zai',         label: 'z.ai / GLM',   envVar: 'ZAI_API_KEY',     type: 'apikey',  desc: 'glm-5.x',                                       models: '5 models' },
    { id: 'minimax',     label: 'minimax',       envVar: 'MINIMAX_API_KEY', type: 'apikey',  desc: 'minimax coding plan',                          models: '3 models' },
    { id: 'opencode-go', label: 'Opencode Go',  envVar: 'OPENCODE_GO_API_KEY', type: 'apikey', desc: 'opencode-minimax-m3, opencode-kimi-k2.7',    models: '11 models' },
    { id: 'local',       label: 'Local server', envVar: null,              type: 'local',   desc: 'LM Studio / llama.cpp / Ollama',                models: '4 models' },
];

// Return a status object for one provider. state is 'empty' | 'set' | 'auth' | 'ready'.
function providerState(p) {
    if (p.type === 'oauth') {
        if (p.id === 'antigravity') return checkAntigravity();
        if (p.id === 'codex') return checkCodex();
    }
    if (p.type === 'local') {
        // Local: 'ready' if anything on common ports, else 'empty'
        return { ok: false, detail: 'auto-detected at runtime' };
    }
    if (p.type === 'apikey') {
        const keys = readEnvKeys(p.envVar);
        if (keys.length === 0) return { ok: false, detail: 'no key set' };
        if (keys.length === 1) return { ok: true, detail: `1 key: ${maskKey(keys[0])}` };
        return { ok: true, detail: `${keys.length} keys (round-robin): ${keys.map(maskKey).join(', ')}` };
    }
    return { ok: false, detail: '?' };
}

function maskKey(k) {
    if (!k || k.length < 8) return '***';
    return k.slice(0, 4) + '\u2026' + k.slice(-4);
}

// Add a key to an API-key provider. Supports multi-account round-robin.
async function manageApiKey(p) {
    while (true) {
        const keys = readEnvKeys(p.envVar);
        console.log();
        console.log(chalk.bold(`  ${p.label}`) + chalk.dim(`  (${p.envVar})`));
        if (keys.length === 0) {
            console.log(`    ${chalk.dim('no keys yet')}`);
        } else {
            keys.forEach((k, i) => console.log(`    ${chalk.green(String(i + 1) + '.')} ${maskKey(k)}`));
        }
        console.log();
        const choices = [
            { name: chalk.green('+ Add a key'), value: 'add' },
        ];
        if (keys.length > 0) {
            choices.push({ name: chalk.red(`\u2212 Remove last key (${maskKey(keys[keys.length - 1])})`), value: 'remove_last' });
            choices.push({ name: chalk.red(`\u2212 Remove all (${keys.length} key${keys.length === 1 ? '' : 's'})`), value: 'remove_all' });
        }
        choices.push({ name: chalk.dim('Back'), value: 'back' });
        const r = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: 'Manage keys',
            choices,
        }]);
        if (r.action === 'back') return;
        if (r.action === 'add') {
            const k = await inquirer.prompt([{
                type: 'password',
                name: 'value',
                message: chalk.cyan(`Paste ${p.label} API key`),
                mask: '*',
                validate: v => v.length >= 4 || 'Looks too short — paste the full key',
            }]);
            if (k.value && k.value.trim()) {
                appendEnvKey(p.envVar, k.value.trim());
                console.log(`    ${log.success}  ${chalk.green('key added')}  ${chalk.dim(`(${p.envVar} now has ${readEnvKeys(p.envVar).length} key(s))`)}`);
            }
        } else if (r.action === 'remove_last') {
            const removed = keys[keys.length - 1];
            removeEnvKey(p.envVar, removed);
            console.log(`    ${log.success}  ${chalk.yellow(`removed ${maskKey(removed)}`)}  ${chalk.dim(`(${readEnvKeys(p.envVar).length} key(s) remain)`)}`);
        } else if (r.action === 'remove_all') {
            for (const k of [...keys]) removeEnvKey(p.envVar, k);
            console.log(`    ${log.success}  ${chalk.yellow(`removed all ${keys.length} key(s)`)}`);
        }
    }
}

async function manageOauth(p) {
    console.log();
    console.log(chalk.bold(`  ${p.label}`));
    const status = p.id === 'antigravity' ? checkAntigravity() : checkCodex();
    if (status.ok) {
        console.log(`    ${log.success}  ${chalk.green('account detected:')} ${chalk.cyan(status.detail)}`);
    } else {
        console.log(`    ${log.warning}  ${chalk.yellow(status.detail)}`);
    }
    console.log();
    const choices = [];
    if (p.id === 'antigravity') {
        choices.push({ name: chalk.dim('Re-check (after you sign in)'), value: 'recheck' });
    }
    if (p.id === 'codex') {
        choices.push({ name: chalk.dim('Re-check (after you sign in)'), value: 'recheck' });
    }
    choices.push({ name: chalk.dim('Back'), value: 'back' });
    const r = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'What next?',
        choices,
    }]);
    if (r.action === 'recheck') {
        const newStatus = p.id === 'antigravity' ? checkAntigravity() : checkCodex();
        if (newStatus.ok) console.log(`    ${log.success}  ${chalk.green('now detected:')} ${chalk.cyan(newStatus.detail)}`);
        else console.log(`    ${log.warning}  ${chalk.yellow(newStatus.detail)}`);
    }
}

async function setup() {
    printBanner();
    console.log(chalk.bold('  Setup'));
    console.log(chalk.dim('  Each row shows the current state. Enter a row to manage it.'));
    console.log(chalk.dim('  Keys are stored in ' + ENV_FILE + ' and shared across accounts via round-robin.'));
    console.log();

    // Always-on config: port
    const portAnswer = await inquirer.prompt([{
        type: 'input',
        name: 'PORT',
        message: chalk.cyan('Server port'),
        default: String(parseInt(process.env.PORT || '6767', 10)),
        validate: (v) => /^\d+$/.test(v) || 'Port must be a number',
    }]);
    // Persist the port
    writeEnv({ PORT: portAnswer.PORT });
    console.log(`    ${log.success}  ${chalk.dim('port saved')}`);
    console.log();

    // Top-level menu loops until the user picks Done
    while (true) {
        const choices = PROVIDERS.map(p => {
            const s = providerState(p);
            let tag = '';
            if (p.type === 'local') tag = chalk.dim('ready');
            else if (s.ok) tag = chalk.green('set   ');
            else tag = chalk.yellow('empty ');
            const desc = s.detail ? chalk.dim(s.detail) : '';
            return { name: `${tag}  ${p.label.padEnd(16)} ${desc}`, value: p.id, short: p.label };
        });
        choices.push(new inquirer.Separator('\u2500'.repeat(40)));
        choices.push({ name: chalk.bold('Done'), value: '__done__' });

        const r = await inquirer.prompt([{
            type: 'list',
            name: 'provider',
            message: 'Manage a provider',
            pageSize: 12,
            loop: false,
            choices,
        }]);

        if (r.provider === '__done__') break;

        const p = PROVIDERS.find(x => x.id === r.provider);
        if (p.type === 'apikey') await manageApiKey(p);
        else if (p.type === 'oauth') await manageOauth(p);
        else if (p.type === 'local') {
            console.log();
            console.log(chalk.bold('  Local server'));
            console.log(`    ${chalk.dim('Local models are served from your machine. Set these env vars in ' + ENV_FILE + ' to point at non-default ports:')}`);
            console.log(`    ${chalk.cyan('LMSTUDIO_BASE_URL=http://localhost:1234/v1')}`);
            console.log(`    ${chalk.cyan('LLAMACPP_BASE_URL=http://localhost:8080/v1')}`);
            console.log(`    ${chalk.cyan('UNSLOTH_BASE_URL=http://localhost:11434/v1')}`);
        }
    }

    console.log();
    console.log(log.success + ' ' + chalk.green('Setup complete.'));
    console.log();
    console.log(chalk.bold('  Next:'));
    console.log(`    ${chalk.cyan('cursor-noodle start')}     ${chalk.dim('# start the proxy + tunnel')}`);
    console.log(`    ${chalk.cyan('cursor-noodle status')}    ${chalk.dim('# show status, providers, model counts')}`);
    console.log(`    ${chalk.cyan('cursor-noodle cheapmf')}   ${chalk.dim('# free-tier fast path (Opencode Zen key)')}`);
    console.log();
}

function writeEnv(values) {
    let content = '';
    if (fs.existsSync(ENV_FILE)) {
        content = fs.readFileSync(ENV_FILE, 'utf8');
    } else if (fs.existsSync(ENV_EXAMPLE)) {
        content = fs.readFileSync(ENV_EXAMPLE, 'utf8');
    }
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined || value === null) continue;
        const re = new RegExp(`^#?\\s*${key}=.*$`, 'm');
        const line = value === '' ? `${key}=` : `${key}=${value}`;
        if (re.test(content)) {
            content = content.replace(re, line);
        } else {
            content += `\n${line}\n`;
        }
    }
    fs.writeFileSync(ENV_FILE, content);
}

// Append a key to a comma-separated list in .env (or create it).
// Returns the new full list (array).
function appendEnvKey(envVar, newKey) {
    let content = '';
    if (fs.existsSync(ENV_FILE)) {
        content = fs.readFileSync(ENV_FILE, 'utf8');
    } else if (fs.existsSync(ENV_EXAMPLE)) {
        content = fs.readFileSync(ENV_EXAMPLE, 'utf8');
    }
    const re = new RegExp(`^${envVar}=(.*)$`, 'm');
    let keys = [];
    const match = content.match(re);
    if (match) {
        keys = match[1].split(',').map(s => s.trim()).filter(Boolean);
        if (!keys.includes(newKey)) keys.push(newKey);
        const newLine = `${envVar}=${keys.join(',')}`;
        content = content.replace(re, newLine);
    } else {
        keys = [newKey];
        content += `\n${envVar}=${newKey}\n`;
    }
    fs.writeFileSync(ENV_FILE, content);
    return keys;
}

// Remove a key from a comma-separated list. If the list becomes empty,
// remove the env var entirely.
function removeEnvKey(envVar, keyToRemove) {
    if (!fs.existsSync(ENV_FILE)) return [];
    let content = fs.readFileSync(ENV_FILE, 'utf8');
    const re = new RegExp(`^${envVar}=(.*)$`, 'm');
    const match = content.match(re);
    if (!match) return [];
    let keys = match[1].split(',').map(s => s.trim()).filter(Boolean);
    keys = keys.filter(k => k !== keyToRemove);
    if (keys.length === 0) {
        content = content.replace(re, '');
        content = content.replace(/\n\n+/g, '\n\n');
    } else {
        content = content.replace(re, `${envVar}=${keys.join(',')}`);
    }
    fs.writeFileSync(ENV_FILE, content);
    return keys;
}

// Read the current keys for an env var from .env (does not touch process.env).
function readEnvKeys(envVar) {
    if (!fs.existsSync(ENV_FILE)) return [];
    const content = fs.readFileSync(ENV_FILE, 'utf8');
    const re = new RegExp(`^${envVar}=(.*)$`, 'm');
    const match = content.match(re);
    if (!match) return [];
    return match[1].split(',').map(s => s.trim()).filter(Boolean);
}

function PORT() {
    return parseInt(process.env.PORT || '6767', 10);
}

// ─── cheapmf: free-tier fast path ─────────────────────────────
async function cheapmf() {
    printBanner();
    console.log(chalk.bold('  Free-tier setup') + chalk.dim('  (cheapmf)'));
    console.log();
    console.log(chalk.dim('  ─'.repeat(54)));
    console.log();
    console.log(chalk.bold('  Get a free Opencode Zen API key in ~30 seconds:'));
    console.log();
    console.log(chalk.bold.cyan('    1.') + ' Go to  ' + chalk.underline.cyan('https://opencode.ai/zen'));
    console.log(chalk.dim('       (sign in with GitHub or email — no credit card)'));
    console.log(chalk.bold.cyan('    2.') + ' Copy your API key  ' + chalk.dim('(starts with sk-)'));
    console.log(chalk.bold.cyan('    3.') + ' Paste it below');
    console.log();
    console.log(chalk.dim('  ─'.repeat(54)));
    console.log();
    console.log(chalk.dim('  That unlocks the free Zen models you can use right away:'));
    console.log(chalk.dim('    n-zen-deepseek-v4-flash-free   n-zen-mimo-v2.5-free   n-zen-north-mini-code-free'));
    console.log();

    if (process.env.OPENCODE_ZEN_API_KEY) {
        console.log(log.info + ' ' + chalk.dim('An Opencode Zen key is already set in your env / .env.'));
        const { again } = await inquirer.prompt([{
            type: 'confirm',
            name: 'again',
            message: chalk.cyan('Replace it with a new key?'),
            default: false,
        }]);
        if (!again) return;
    }

    const { apiKey } = await inquirer.prompt([{
        type: 'password',
        name: 'apiKey',
        message: chalk.cyan('Paste your Opencode Zen API key'),
        mask: '*',
        validate: (v) => (v && v.trim().startsWith('sk-')) || 'Key should start with "sk-". Try again.',
    }]);

    // Quick smoke test against the Zen free model
    const key = apiKey.trim();
    const spinner = ora({ text: 'Testing key against zen-north-mini-code-free...', color: 'cyan' }).start();
    try {
        const out = execSync(
            `curl -s --max-time 30 -X POST https://opencode.ai/zen/v1/chat/completions ` +
            `-H "Content-Type: application/json" -H "Authorization: Bearer ${key}" ` +
            `-d '{"model":"north-mini-code-free","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'`,
            { encoding: 'utf8' }
        );
        const data = JSON.parse(out);
        spinner.stop();
        if (data.choices && data.choices[0]) {
            console.log(log.success + ' ' + chalk.green('Key works!') + chalk.dim('  (zen-north-mini-code-free responded)'));
        } else if (data.error) {
            console.log(log.warning + ' ' + chalk.yellow('Key saved, but test call returned:'));
            console.log(chalk.dim('    ' + (data.error.message || JSON.stringify(data.error)).slice(0, 120)));
            console.log(chalk.dim('    (You can still use it once your account is active.)'));
        } else {
            console.log(log.warning + ' ' + chalk.yellow('Unexpected response — saving key anyway.'));
            console.log(chalk.dim('    ' + JSON.stringify(data).slice(0, 160)));
        }
    } catch (e) {
        spinner.stop();
        console.log(log.warning + ' ' + chalk.yellow('Could not test the key right now — saving it anyway.'));
    }

    // Save to .env
    const spinner2 = ora({ text: 'Saving to .env...', color: 'cyan' }).start();
    try {
        ensureEnvFile();
        writeEnv({ OPENCODE_ZEN_API_KEY: key });
        spinner2.stop();
        console.log(log.success + ' ' + chalk.green('Saved to .env'));
    } catch (e) {
        spinner2.stop();
        console.log(log.error + ' ' + chalk.red(`Failed to write .env: ${e.message}`));
        return;
    }

    console.log();
    console.log(chalk.bold('  Next:'));
    console.log(`    ${chalk.cyan('cursor-noodle start')}      ${chalk.dim('# start the proxy + tunnel')}`);
    console.log(`    ${chalk.cyan('cursor-noodle models')}     ${chalk.dim('# see your available models')}`);
    console.log();
    console.log(chalk.dim('  In Cursor, add these custom models (free forever):'));
    console.log(chalk.dim('    n-zen-north-mini-code-free'));
    console.log(chalk.dim('    n-zen-deepseek-v4-flash-free'));
    console.log(chalk.dim('    n-zen-mimo-v2.5-free'));
    console.log();
}

function restart() {
    if (isRunning()) {
        stop();
        setTimeout(() => start(), 1500);
    } else {
        start();
    }
}

// ─── CLI ──────────────────────────────────────────────────
const program = new Command();

program
    .name('cursor-noodle')
    .description('Cursor on an instant-noodle budget — Antigravity · Codex · z.ai · Opencode · Local')
    .version(require('../package.json').version)
    .addHelpText('after', `
${chalk.bold('Examples:')}
  ${chalk.cyan('cursor-noodle setup')}      ${chalk.dim('# interactive API key setup')}
  ${chalk.cyan('cursor-noodle cheapmf')}    ${chalk.dim('# free-tier fast path (Opencode Zen key)')}
  ${chalk.cyan('cursor-noodle start')}      ${chalk.dim('# start proxy + tunnel in background')}
  ${chalk.cyan('cursor-noodle status')}     ${chalk.dim('# show running state + tunnel URL')}
  ${chalk.cyan('cursor-noodle models')}     ${chalk.dim('# list all available models')}
  ${chalk.cyan('cursor-noodle logs')}       ${chalk.dim('# tail the proxy log')}
  ${chalk.cyan('cursor-noodle stop')}       ${chalk.dim('# stop the proxy')}
`);

program
    .command('start')
    .description('Start the proxy + tunnel in the background')
    .action(() => start());

program
    .command('stop')
    .description('Stop the running proxy')
    .action(() => stop());

program
    .command('restart')
    .description('Stop then start the proxy')
    .action(() => restart());

program
    .command('status')
    .description('Show running state, PID, port, and tunnel URL')
    .action(() => status());

program
    .command('setup')
    .alias('config')
    .description('Interactive setup wizard — write API keys to .env')
    .action(() => setup());

program
    .command('cheapmf')
    .description('Fast path to free models — get an Opencode Zen key and use DeepSeek/MiMo/North for free')
    .action(() => cheapmf());

program
    .command('logs')
    .alias('log')
    .alias('tail')
    .description('Tail the proxy log (Ctrl+C to exit)')
    .action(() => logs());

program
    .command('tunnel')
    .alias('url')
    .description('Print the current Cloudflare tunnel URL')
    .action(() => tunnel());

program
    .command('models')
    .description('List all models available through the proxy')
    .action(() => models());

// Default action (no subcommand) = start
program.action(() => start());

// Handle --help and -h explicitly
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    program.outputHelp();
    process.exit(0);
}

program.parseAsync(process.argv).catch((err) => {
    console.error(chalk.red('Error:'), err.message);
    process.exit(1);
});
