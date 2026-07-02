'use strict';

const MODELS = [
    // --- Antigravity ---
    { id: 'gemini-3.5-flash-medium', provider: 'antigravity', name: 'Gemini 3.5 Flash (Medium)', desc: 'Fast with balanced reasoning', icon: '⚡' },
    { id: 'gemini-3.5-flash-high', provider: 'antigravity', name: 'Gemini 3.5 Flash (High)', desc: 'Flash with higher reasoning', icon: '⚡' },
    { id: 'gemini-3.5-flash-low', provider: 'antigravity', name: 'Gemini 3.5 Flash (Low)', desc: 'Fastest responses', icon: '⚡' },
    { id: 'gemini-3.1-pro-low', provider: 'antigravity', name: 'Gemini 3.1 Pro (Low)', desc: 'Pro model, lighter reasoning', icon: '🍜' },
    { id: 'gemini-3.1-pro-high', provider: 'antigravity', name: 'Gemini 3.1 Pro (High)', desc: 'Pro model, deep reasoning', icon: '🍜' },
    { id: 'claude-sonnet-4-6', provider: 'antigravity', name: 'Claude Sonnet 4.6 (Thinking)', desc: 'Advanced reasoning + extended thinking', icon: '🍜' },
    { id: 'claude-opus-4-6-thinking', provider: 'antigravity', name: 'Claude Opus 4.6 (Thinking)', desc: 'Maximum intelligence', icon: '🍜' },
    { id: 'gpt-oss-120b-medium', provider: 'antigravity', name: 'GPT-OSS 120B (Medium)', desc: 'Open source via Antigravity', icon: '🍜' },

    // --- MiniMax ---
    { id: 'minimax-m3', provider: 'minimax', name: 'MiniMax M3', desc: 'MiniMax coding plan', icon: '🍜' },
    { id: 'minimax-m2.7', provider: 'minimax', name: 'MiniMax M2.7', desc: 'MiniMax coding plan', icon: '🍜' },
    { id: 'minimax-m2.5', provider: 'minimax', name: 'MiniMax M2.5', desc: 'MiniMax coding plan', icon: '🍜' },

    // --- Codex (ChatGPT) — each model exposes 5 reasoning-effort variants ---
    { id: 'gpt-5.5-none', provider: 'codex', name: 'GPT-5.5 (no reasoning)', desc: 'Fastest, no chain-of-thought', icon: '🍜' },
    { id: 'gpt-5.5-light', provider: 'codex', name: 'GPT-5.5 (light reasoning)', desc: 'Light reasoning, fast', icon: '🍜' },
    { id: 'gpt-5.5-medium', provider: 'codex', name: 'GPT-5.5 (medium reasoning)', desc: 'Balanced reasoning (default)', icon: '🍜' },
    { id: 'gpt-5.5-high', provider: 'codex', name: 'GPT-5.5 (high reasoning)', desc: 'Deep reasoning, slower', icon: '🍜' },
    { id: 'gpt-5.5-xhigh', provider: 'codex', name: 'GPT-5.5 (xhigh reasoning)', desc: 'Maximum reasoning', icon: '🍜' },

    { id: 'gpt-5.4-none', provider: 'codex', name: 'GPT-5.4 (no reasoning)', desc: 'Fastest', icon: '🍜' },
    { id: 'gpt-5.4-light', provider: 'codex', name: 'GPT-5.4 (light reasoning)', desc: 'Light reasoning', icon: '🍜' },
    { id: 'gpt-5.4-medium', provider: 'codex', name: 'GPT-5.4 (medium reasoning)', desc: 'Balanced', icon: '🍜' },
    { id: 'gpt-5.4-high', provider: 'codex', name: 'GPT-5.4 (high reasoning)', desc: 'Deep reasoning', icon: '🍜' },
    { id: 'gpt-5.4-xhigh', provider: 'codex', name: 'GPT-5.4 (xhigh reasoning)', desc: 'Maximum reasoning', icon: '🍜' },

    { id: 'gpt-5.4-mini', provider: 'codex', name: 'GPT-5.4 Mini (Codex)', desc: 'Faster, cheaper GPT-5.4', icon: '🍜' },

    // --- z.ai (GLM) ---
    { id: 'glm-5.2', provider: 'zai', name: 'GLM-5.2 (z.ai)', desc: 'Latest z.ai flagship', icon: '🇿' },
    { id: 'glm-5.1', provider: 'zai', name: 'GLM-5.1 (z.ai)', desc: 'z.ai', icon: '🇿' },
    { id: 'glm-5', provider: 'zai', name: 'GLM-5 (z.ai)', desc: 'z.ai', icon: '🇿' },
    { id: 'glm-4.7', provider: 'zai', name: 'GLM-4.7 (z.ai)', desc: 'z.ai', icon: '🇿' },
    { id: 'glm-4.6', provider: 'zai', name: 'GLM-4.6 (z.ai)', desc: 'z.ai', icon: '🇿' },

    // --- Opencode Zen ---
    { id: 'zen-gpt-5.5', provider: 'zen', name: 'Zen · GPT-5.5', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-gpt-5.5-pro', provider: 'zen', name: 'Zen · GPT-5.5 Pro', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-claude-opus-4-8', provider: 'zen', name: 'Zen · Claude Opus 4.8', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-claude-opus-4-6', provider: 'zen', name: 'Zen · Claude Opus 4.6', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-claude-sonnet-4-6', provider: 'zen', name: 'Zen · Claude Sonnet 4.6', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-gemini-3.5-flash', provider: 'zen', name: 'Zen · Gemini 3.5 Flash', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-gemini-3.1-pro', provider: 'zen', name: 'Zen · Gemini 3.1 Pro', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-glm-5.2', provider: 'zen', name: 'Zen · GLM-5.2', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-minimax-m3', provider: 'zen', name: 'Zen · MiniMax M3', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-kimi-k2.7-code', provider: 'zen', name: 'Zen · Kimi K2.7', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-qwen3.6-plus', provider: 'zen', name: 'Zen · Qwen 3.6 Plus', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-big-pickle', provider: 'zen', name: 'Zen · Big Pickle', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-grok-build-0.1', provider: 'zen', name: 'Zen · Grok Build', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-deepseek-v4-pro', provider: 'zen', name: 'Zen · DeepSeek V4 Pro', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-deepseek-v4-flash-free', provider: 'zen', name: 'Zen · DeepSeek V4 Flash (Free)', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-mimo-v2.5-free', provider: 'zen', name: 'Zen · MiMo v2.5 (Free)', desc: 'Opencode Zen', icon: '🍜' },
    { id: 'zen-north-mini-code-free', provider: 'zen', name: 'Zen · North Mini Code (Free)', desc: 'Opencode Zen', icon: '🍜' },

    // --- Opencode Go (opencode.ai/zen/go/v1) ---
    { id: 'opencode-minimax-m3', provider: 'opencode', name: 'Opencode · MiniMax M3', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-minimax-m2.7', provider: 'opencode', name: 'Opencode · MiniMax M2.7', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-minimax-m2.5', provider: 'opencode', name: 'Opencode · MiniMax M2.5', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-glm-5.2', provider: 'opencode', name: 'Opencode · GLM-5.2', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-glm-5.1', provider: 'opencode', name: 'Opencode · GLM-5.1', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-glm-5', provider: 'opencode', name: 'Opencode · GLM-5', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-kimi-k2.7-code', provider: 'opencode', name: 'Opencode · Kimi K2.7', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-kimi-k2.6', provider: 'opencode', name: 'Opencode · Kimi K2.6', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-kimi-k2.5', provider: 'opencode', name: 'Opencode · Kimi K2.5', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-qwen3.7-max', provider: 'opencode', name: 'Opencode · Qwen 3.7 Max', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-qwen3.7-plus', provider: 'opencode', name: 'Opencode · Qwen 3.7 Plus', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-qwen3.6-plus', provider: 'opencode', name: 'Opencode · Qwen 3.6 Plus', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-qwen3.5-plus', provider: 'opencode', name: 'Opencode · Qwen 3.5 Plus', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-deepseek-v4-pro', provider: 'opencode', name: 'Opencode · DeepSeek V4 Pro', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-deepseek-v4-flash', provider: 'opencode', name: 'Opencode · DeepSeek V4 Flash', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-mimo-v2.5-pro', provider: 'opencode', name: 'Opencode · MiMo v2.5 Pro', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-mimo-v2.5', provider: 'opencode', name: 'Opencode · MiMo v2.5', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-mimo-v2-pro', provider: 'opencode', name: 'Opencode · MiMo v2 Pro', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-mimo-v2-omni', provider: 'opencode', name: 'Opencode · MiMo v2 Omni', desc: 'Opencode Go', icon: '🍜' },
    { id: 'opencode-hy3-preview', provider: 'opencode', name: 'Opencode · Hy3 Preview', desc: 'Opencode Go', icon: '🍜' },

    // --- Local: LMStudio ---
    { id: 'lmstudio:qwen3.6-27b', provider: 'lmstudio', name: 'LMStudio · Qwen3.6 27B', desc: 'Local', icon: '🍜' },
    { id: 'lmstudio:qwen2.5-coder-32b', provider: 'lmstudio', name: 'LMStudio · Qwen2.5 Coder 32B', desc: 'Local', icon: '🍜' },

    // --- Local: llama.cpp ---
    { id: 'llamacpp:qwen3.6-27b', provider: 'llamacpp', name: 'llama.cpp · Qwen3.6 27B', desc: 'Local', icon: '🍜' },

    // --- Local: Unsloth ---
    { id: 'unsloth:qwen3.6-27b', provider: 'unsloth', name: 'Unsloth · Qwen3.6 27B', desc: 'Local', icon: '🍜' },
];
function advertisedModels() {
    return MODELS.map(m => ({
        id: 'n-' + m.id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: m.provider,
    }));
}
module.exports = { MODELS, advertisedModels };
