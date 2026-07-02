const https = require('https');
const crypto = require('crypto');
const { getAuth } = require('../auth/minimax.cjs');

const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimax.io/anthropic';

// Map user-facing model IDs to actual API model names.
// MiniMax-M3 works cleanly. M2.7/M2.5 default to thinking-only output,
// so we request thinking: disabled to get the actual response.
const MODEL_MAPPING = {
    'minimax-m3': 'MiniMax-M3',
    'MiniMax-M3': 'MiniMax-M3',
    'minimax-m2.7': 'MiniMax-M2.7',
    'MiniMax-M2.7': 'MiniMax-M2.7',
    'minimax-m2.5': 'MiniMax-M2.5',
    'MiniMax-M2.5': 'MiniMax-M2.5',
    'minimax-m2': 'MiniMax-M2.7',
    'MiniMax-M2': 'MiniMax-M2.7',
    'minimax': 'MiniMax-M3',
};

const SYSTEM_INSTRUCTION = 'You are an expert coding assistant. Help the user with their coding tasks. Be direct, concise, and accurate.';

// Convert OpenAI messages to Anthropic format
function messagesToAnthropic(messages) {
    const out = { messages: [], system: undefined };
    for (const m of messages) {
        if (m.role === 'system') {
            const t = typeof m.content === 'string' ? m.content : '';
            out.system = out.system ? out.system + '\n\n' + t : t;
            continue;
        }
        if (m.role === 'tool') {
            out.messages.push({
                role: 'user',
                content: [{
                    type: 'tool_result',
                    tool_use_id: m.tool_call_id,
                    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                }],
            });
            continue;
        }
        if (m.role === 'assistant') {
            const blocks = [];
            if (m.content) blocks.push({ type: 'text', text: typeof m.content === 'string' ? m.content : '' });
            if (m.tool_calls) {
                for (const tc of m.tool_calls) {
                    let input = {};
                    try { input = JSON.parse(tc.function.arguments); } catch (e) { }
                    blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
                }
            }
            out.messages.push({ role: 'assistant', content: blocks });
            continue;
        }
        // user
        let blocks;
        if (typeof m.content === 'string') {
            blocks = [{ type: 'text', text: m.content }];
        } else if (Array.isArray(m.content)) {
            blocks = m.content.map(p => {
                if (p.type === 'text') return { type: 'text', text: p.text };
                if (p.type === 'image_url' && p.image_url && p.image_url.url) {
                    const m = p.image_url.url.match(/^data:(image\/\w+);base64,(.+)$/);
                    if (m) return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
                }
                return null;
            }).filter(Boolean);
        } else {
            blocks = [{ type: 'text', text: '' }];
        }
        out.messages.push({ role: 'user', content: blocks });
    }
    if (!out.system) {
        out.system = SYSTEM_INSTRUCTION;
    }
    return out;
}

function buildRequest({ model, messages, max_tokens, temperature, top_p, stop, tools, tool_choice, stream }) {
    const { messages: anthropicMessages, system } = messagesToAnthropic(messages);
    const apiModel = MODEL_MAPPING[model] || model;

    // Determine max_tokens (Anthropic requires it)
    const target = Math.max(max_tokens || 4096, 1024);

    const req = {
        model: apiModel,
        max_tokens: target,
        messages: anthropicMessages,
        system,
        stream: true,  // always stream from upstream; the proxy handles the user-facing stream mode
    };
    if (temperature !== undefined) req.temperature = temperature;
    if (top_p !== undefined) req.top_p = top_p;
    if (stop) req.stop_sequences = Array.isArray(stop) ? stop : [stop];

    // Disable thinking for cleaner output (MiniMax M2.x defaults to thinking-only)
    req.thinking = { type: 'disabled' };

    // Tools
    if (tools && tools.length > 0) {
        req.tools = tools.map(t => ({
            name: t.function.name,
            description: t.function.description || '',
            input_schema: t.function.parameters || { type: 'object', properties: {} },
        }));
    }
    if (tool_choice) {
        if (tool_choice === 'auto') req.tool_choice = { type: 'auto' };
        else if (tool_choice === 'none') req.tool_choice = { type: 'none' };
        else if (tool_choice === 'required') req.tool_choice = { type: 'any' };
        else if (typeof tool_choice === 'object' && tool_choice.function) {
            req.tool_choice = { type: 'tool', name: tool_choice.function.name };
        }
    }

    return req;
}

function minimaxRequest({ apiKey, body, stream }) {
    const data = JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const url = new URL(`${MINIMAX_BASE_URL}/v1/messages`);
        const req = https.request({
            hostname: url.hostname,
            port: 443,
            path: url.pathname,
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'Accept': stream ? 'text/event-stream' : 'application/json',
            },
        }, (res) => {
            resolve(res);
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// Map Anthropic SSE event -> OpenAI chunk
function mapSSEToOpenAI(event, data, originalModel) {
    if (event === 'content_block_delta') {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { return null; }
        if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
            return {
                id: 'chatcmpl-' + crypto.randomUUID(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: originalModel,
                choices: [{ index: 0, delta: { content: parsed.delta.text }, finish_reason: null }],
            };
        }
        if (parsed.delta?.type === 'input_json_delta' && parsed.delta.partial_json) {
            // Tool input delta — accumulator would be better but emit raw
            return {
                id: 'chatcmpl-' + crypto.randomUUID(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: originalModel,
                choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: parsed.delta.partial_json } }] }, finish_reason: null }],
            };
        }
        return null;
    }
    if (event === 'content_block_start') {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { return null; }
        if (parsed.content_block?.type === 'tool_use') {
            return {
                id: 'chatcmpl-' + crypto.randomUUID(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: originalModel,
                choices: [{
                    index: 0,
                    delta: {
                        tool_calls: [{
                            index: 0,
                            id: parsed.content_block.id || ('call_' + crypto.randomUUID().substring(0, 8)),
                            type: 'function',
                            function: { name: parsed.content_block.name, arguments: '' },
                        }],
                    },
                    finish_reason: null,
                }],
            };
        }
        return null;
    }
    if (event === 'message_delta') {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { return null; }
        if (parsed.delta?.stop_reason) {
            const mapped = parsed.delta.stop_reason === 'end_turn' ? 'stop'
                : parsed.delta.stop_reason === 'tool_use' ? 'tool_calls'
                : parsed.delta.stop_reason === 'max_tokens' ? 'length'
                : 'stop';
            return {
                id: 'chatcmpl-' + crypto.randomUUID(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: originalModel,
                choices: [{ index: 0, delta: {}, finish_reason: mapped }],
            };
        }
        return null;
    }
    if (event === 'message_stop') {
        return null; // handled separately
    }
    return null;
}

// Collect full response from SSE stream
async function collectFromSSE(remoteRes, originalModel) {
    return new Promise((resolve, reject) => {
        let buffer = '';
        let eventName = '';
        let accumulatedText = '';
        let toolCalls = [];
        let usage = null;
        let currentToolCall = null;
        remoteRes.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (line.startsWith('event:')) {
                    eventName = line.substring(6).trim();
                } else if (line.startsWith('data:')) {
                    const data = line.substring(5).trim();
                    if (!data) continue;
                    try {
                        const parsed = JSON.parse(data);
                        if (eventName === 'content_block_delta') {
                            if (parsed.delta?.type === 'text_delta') {
                                accumulatedText += parsed.delta.text;
                            } else if (parsed.delta?.type === 'input_json_delta' && currentToolCall) {
                                currentToolCall.arguments += parsed.delta.partial_json;
                            }
                        } else if (eventName === 'content_block_start') {
                            if (parsed.content_block?.type === 'tool_use') {
                                currentToolCall = {
                                    id: parsed.content_block.id,
                                    name: parsed.content_block.name,
                                    arguments: '',
                                };
                            }
                        } else if (eventName === 'content_block_stop') {
                            if (currentToolCall) {
                                toolCalls.push({
                                    id: currentToolCall.id,
                                    type: 'function',
                                    function: {
                                        name: currentToolCall.name,
                                        arguments: currentToolCall.arguments,
                                    },
                                });
                                currentToolCall = null;
                            }
                        } else if (eventName === 'message_delta') {
                            if (parsed.usage) usage = parsed.usage;
                        } else if (eventName === 'message_start') {
                            if (parsed.message?.usage) usage = parsed.message.usage;
                        }
                    } catch (e) { }
                }
            }
        });
        remoteRes.on('end', () => {
            resolve({
                id: 'chatcmpl-' + crypto.randomUUID(),
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: originalModel,
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: accumulatedText,
                        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                    },
                    finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
                }],
                usage: usage ? {
                    prompt_tokens: usage.input_tokens || 0,
                    completion_tokens: usage.output_tokens || 0,
                    total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
                } : undefined,
            });
        });
        remoteRes.on('error', reject);
    });
}

function streamSSE(remoteRes, originalModel, res) {
    let buffer = '';
    let eventName = '';
    remoteRes.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (line.startsWith('event:')) {
                eventName = line.substring(6).trim();
            } else if (line.startsWith('data:')) {
                const data = line.substring(5).trim();
                if (!data) continue;
                const chunk = mapSSEToOpenAI(eventName, data, originalModel);
                if (chunk) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
        }
    });
    remoteRes.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
    });
    remoteRes.on('error', e => {
        res.write(`data: ${JSON.stringify({ error: { message: e.message } })}\n\n`);
        res.end();
    });
}

async function chatCompletion({ model, messages, stream, max_tokens, temperature, top_p, stop, tools, tool_choice }, res) {
    const auth = await getAuth();
    if (!auth) {
        throw new Error('MiniMax auth unavailable. Set MINIMAX_API_KEY or install opencode and add minimax-coding-plan key.');
    }
    const body = buildRequest({ model, messages, max_tokens, temperature, top_p, stop, tools, tool_choice, stream });

    const remoteRes = await minimaxRequest({ apiKey: auth.apiKey, body, stream: true });
    if (remoteRes.statusCode !== 200) {
        let errBody = '';
        remoteRes.on('data', c => errBody += c);
        remoteRes.on('end', () => {
            const errMsg = `MiniMax ${remoteRes.statusCode}: ${errBody.substring(0, 400)}`;
            if (stream) {
                res.write(`data: ${JSON.stringify({ error: { message: errMsg, code: remoteRes.statusCode } })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
            } else {
                res.status(remoteRes.statusCode).json({ error: { message: errMsg, code: remoteRes.statusCode, raw: errBody.substring(0, 1000) } });
            }
        });
        return;
    }
    if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        streamSSE(remoteRes, model, res);
    } else {
        const final = await collectFromSSE(remoteRes, model);
        res.json(final);
    }
}

module.exports = { chatCompletion, MODEL_MAPPING };
