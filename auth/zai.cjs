const fs = require('fs');
const os = require('os');
const path = require('path');

// z.ai (GLM) auth.
// Priority:
//   1. ZAI_API_KEY env var (direct API key)
//   2. zai-coding-plan key from ~/.local/share/opencode/auth.json
//      (routes via the opencode relay at opencode.ai/zen/go/v1)
const OPENCODE_AUTH_PATH = process.env.OPENCODE_AUTH_PATH ||
    path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');

let cachedKey = null;

function getAuth() {
    // 1) Explicit env var
    if (process.env.ZAI_API_KEY) {
        return {
            apiKey: process.env.ZAI_API_KEY,
            baseURL: process.env.ZAI_BASE_URL || 'https://api.z.ai/api/coding/paas/v4',
            source: 'env',
        };
    }

    // 2) opencode auth.json — the zai-coding-plan key is a direct z.ai key
    if (!cachedKey) {
        try {
            if (fs.existsSync(OPENCODE_AUTH_PATH)) {
                const data = JSON.parse(fs.readFileSync(OPENCODE_AUTH_PATH, 'utf8'));
                const plan = data['zai-coding-plan'];
                if (plan && plan.key) {
                    cachedKey = plan.key;
                }
            }
        } catch (e) { }
    }
    if (cachedKey) {
        return {
            apiKey: cachedKey,
            baseURL: process.env.ZAI_BASE_URL || 'https://api.z.ai/api/coding/paas/v4',
            source: 'opencode-coding-plan',
        };
    }
    return null;
}

module.exports = { getAuth };
