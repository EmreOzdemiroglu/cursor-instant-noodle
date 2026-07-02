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

function status() {
    printBanner();
    const pid = isRunning();
    const port = PORT();
    if (pid) {
        const tunnel = readTunnelFromLog();
        const table = [
            [chalk.bold('Status'), chalk.green('running')],
            [chalk.bold('PID'), String(pid)],
            [chalk.bold('Port'), String(port)],
            [chalk.bold('Log'), chalk.dim(LOG_FILE)],
            [chalk.bold('Local'), chalk.cyan(`http://localhost:${port}/v1`)],
            [chalk.bold('Tunnel'), tunnel ? chalk.cyan(tunnel) : chalk.dim('(waiting...)')],
        ];
        const rows = table.map(([k, v]) => `  ${k.padEnd(8)} ${v}`).join('\n');
        console.log(rows);
    } else {
        console.log(`  ${chalk.bold('Status')}  ${chalk.red('stopped')}`);
        console.log(`  ${chalk.bold('Port')}    ${port}`);
        console.log();
        console.log(`  Run ${chalk.cyan('cursor-noodle start')} to start the proxy.`);
    }
    console.log();
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
async function setup() {
    printBanner();
    console.log(chalk.bold('  Setup wizard'));
    console.log(chalk.dim('  Press Enter to skip any provider.\n'));

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'OPENCODE_ZEN_API_KEY',
            message: chalk.cyan('Opencode Zen API key') + chalk.dim(' (gpt-5.5, claude-opus-4-8, gemini-3.5-flash...)'),
            default: '',
        },
        {
            type: 'input',
            name: 'ZAI_API_KEY',
            message: chalk.cyan('z.ai / GLM API key') + chalk.dim(' (optional — blank = use opencode fallback)'),
            default: '',
        },
        {
            type: 'input',
            name: 'PORT',
            message: chalk.cyan('Server port'),
            default: '6767',
            validate: (v) => /^\d+$/.test(v) || 'Port must be a number',
        },
    ]);

    // Detect local auth
    const agPath = path.join(os.homedir(), '.config', 'opencode', 'antigravity-accounts.json');
    const codexPath = path.join(os.homedir(), '.codex', 'auth.json');
    const hasAg = fs.existsSync(agPath);
    const hasCodex = fs.existsSync(codexPath);

    console.log();
    console.log(chalk.bold('  Detected local auth:'));
    console.log(`    ${hasAg ? log.success : log.error}   Antigravity   ${hasAg ? chalk.green('(found)') : chalk.dim('(not found)')}`);
    console.log(`    ${hasCodex ? log.success : log.error}   Codex/ChatGPT  ${hasCodex ? chalk.green('(found)') : chalk.dim('(not found)')}`);
    console.log();

    // Write .env
    const spinner = ora({ text: 'Writing .env...', color: 'cyan' }).start();
    try {
        ensureEnvFile();
        writeEnv(answers);
        spinner.stop();
        console.log(log.success + ' ' + chalk.green('Saved to .env'));
    } catch (e) {
        spinner.stop();
        console.log(log.error + ' ' + chalk.red(`Failed to write .env: ${e.message}`));
        return;
    }

    console.log(chalk.dim(`  File: ${ENV_FILE}`));
    console.log();
    console.log(chalk.bold('  Next:'));
    console.log(`    ${chalk.cyan('cursor-noodle start')}     ${chalk.dim('# start the proxy')}`);
    console.log(`    ${chalk.cyan('cursor-noodle status')}    ${chalk.dim('# show status + tunnel URL')}`);
    console.log(`    ${chalk.cyan('cursor-noodle models')}    ${chalk.dim('# list available models')}`);
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
        if (!value) continue;
        const re = new RegExp(`^#?\\s*${key}=.*$`, 'm');
        if (re.test(content)) {
            content = content.replace(re, `${key}=${value}`);
        } else {
            content += `\n${key}=${value}\n`;
        }
    }
    fs.writeFileSync(ENV_FILE, content);
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
