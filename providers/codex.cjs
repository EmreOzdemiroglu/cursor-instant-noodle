const https = require('https');
const crypto = require('crypto');
const { getAuth } = require('../auth/codex.cjs');

const CODEX_BASE_URL = 'chatgpt.com';
const CODEX_PATH = '/backend-api/codex/responses';

const DEFAULT_MODELS = {
    'gpt-5.5': 'gpt-5.5',
    'gpt-5.4': 'gpt-5.4',
    'gpt-5.3': 'gpt-5.3',
    'gpt-5.2': 'gpt-5.2',
    'gpt-5.1': 'gpt-5.1',
    'gpt-5.1-codex': 'gpt-5.1-codex',
    'gpt-5': 'gpt-5',
    'gpt-5-codex': 'gpt-5-codex',
    'codex': 'gpt-5.5',
    'codex-1': 'codex-1',
    'gpt-5.4-mini': 'gpt-5.4-mini',
};

// Convert chat completions messages to codex responses input
function messagesToInput(messages) {
    const input = [];
    for (const m of messages) {
        if (m.role === 'system') continue;  // handled via instructions
        if (m.role === 'tool') {
            input.push({
                type: 'function_call_output',
                call_id: m.tool_call_id,
                output: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            });
            continue;
        }
        if (m.role === 'assistant') {
            if (m.tool_calls && m.tool_calls.length > 0) {
                for (const tc of m.tool_calls) {
                    let args = {};
                    try { args = JSON.parse(tc.function.arguments); } catch (e) { }
                    input.push({
                        type: 'function_call',
                        call_id: tc.id,
                        name: tc.function.name,
                        arguments: JSON.stringify(args),
                    });
                }
            }
            if (m.content) {
                input.push({
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: typeof m.content === 'string' ? m.content : '' }],
                });
            }
            continue;
        }
        // user / developer
        let content = [];
        if (typeof m.content === 'string') {
            content = [{ type: 'input_text', text: m.content }];
        } else if (Array.isArray(m.content)) {
            content = m.content.map(p => {
                if (p.type === 'text') return { type: 'input_text', text: p.text };
                if (p.type === 'image_url' && p.image_url && p.image_url.url) {
                    return { type: 'input_image', image_url: p.image_url.url };
                }
                return null;
            }).filter(Boolean);
        }
        input.push({ type: 'message', role: 'user', content });
    }
    return input;
}

function buildRequest({ model, messages, max_tokens, temperature, top_p, tools, tool_choice, stream }) {
    const sysMsgs = messages.filter(m => m.role === 'system');
    const instructions = sysMsgs.map(m => m.content).join('\n\n') || undefined;

    const codexTools = (tools || []).map(t => {
        // Cursor (and some clients) send tools in slightly different shapes.
        // Be defensive: support {function: {name,...}} and {name, ...} flat.
        const fn = t.function || t;
        return {
            type: 'function',
            name: fn.name,
            description: fn.description || '',
            parameters: fn.parameters || { type: 'object', properties: {} },
        };
    }).filter(t => t.name);

    const req = {
        model: DEFAULT_MODELS[model] || model,
        store: false,
        stream: !!stream,
        input: messagesToInput(messages),
    };
    if (instructions) req.instructions = instructions;
    // max_output_tokens is not supported on this endpoint — omit
    if (temperature !== undefined) req.temperature = temperature;
    if (top_p !== undefined) req.top_p = top_p;
    if (codexTools.length > 0) req.tools = codexTools;
    if (tool_choice === 'auto') req.parallel_tool_calls = true;
    if (tool_choice === 'none') req.parallel_tool_calls = false;
    // Always include reasoning for ChatGPT-backed gpt-5 family
    req.reasoning = { effort: 'low' };

    return req;
}

function codexRequest({ token, accountId, body, stream }) {
    const data = JSON.stringify(body);
    const opts = {
        hostname: CODEX_BASE_URL,
        port: 443,
        path: CODEX_PATH,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            'Accept': stream ? 'text/event-stream' : 'application/json',
            'OpenAI-Beta': 'responses=experimental',
            'originator': 'codex_cli_rs',
        },
    };
    if (accountId) opts.headers['chatgpt-account-id'] = accountId;

    return new Promise((resolve, reject) => {
        const req = https.request(opts, (res) => {
            resolve(res);
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// Parse a single SSE event into an OpenAI chat completion chunk (or null)
function parseSSEEventToChunk(event, eventData, originalModel) {
    if (event !== 'response.output_text.delta' && event !== 'response.content_part.delta') {
        return null;
    }
    let parsed;
    try { parsed = JSON.parse(eventData); } catch (e) { return null; }
    const delta = parsed.delta || parsed.text || '';
    if (!delta) return null;
    return {
        id: 'chatcmpl-' + (parsed.response_id || crypto.randomUUID()),
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: originalModel,
        choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
    };
}

function parseSSEEventToFinal(event, eventData, originalModel) {
    if (event !== 'response.completed' && event !== 'response.done') return null;
    let parsed;
    try { parsed = JSON.parse(eventData); } catch (e) { return null; }
    const response = parsed.response || {};
    const out = response.output || [];
    let content = '';
    let toolCalls = [];
    for (const item of out) {
        if (item.type === 'message') {
            for (const c of (item.content || [])) {
                if (c.type === 'output_text' && c.text) content += c.text;
            }
        } else if (item.type === 'function_call') {
            toolCalls.push({
                id: item.call_id || ('call_' + crypto.randomUUID().substring(0, 8)),
                type: 'function',
                function: {
                    name: item.name,
                    arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}),
                },
            });
        }
    }
    return {
        id: 'chatcmpl-' + (response.id || crypto.randomUUID()),
        object: 'chat.completion',
        created: Math.floor((response.created_at || Date.now() / 1000)),
        model: originalModel,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content,
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            },
            finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
        }],
        usage: response.usage ? {
            prompt_tokens: response.usage.input_tokens || 0,
            completion_tokens: response.usage.output_tokens || 0,
            total_tokens: response.usage.total_tokens || 0,
        } : undefined,
    };
}

function streamFromCodexResponse(remoteRes, originalModel, res) {
    let buffer = '';
    let eventName = '';
    let lastResponse = null;

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
                if (eventName === 'response.completed' || eventName === 'response.done') {
                    try { lastResponse = JSON.parse(data).response; } catch (e) { }
                }
                const chunk = parseSSEEventToChunk(eventName, data, originalModel);
                if (chunk) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
        }
    });

    remoteRes.on('end', () => {
        // Emit final chunk with usage if we have a completed response
        if (lastResponse) {
            const final = parseSSEEventToFinal('response.completed', JSON.stringify({ response: lastResponse }), originalModel);
            if (final) {
                if (final.usage) {
                    res.write(`data: ${JSON.stringify({
                        id: final.id,
                        object: 'chat.completion.chunk',
                        created: final.created,
                        model: originalModel,
                        choices: [],
                        usage: final.usage,
                    })}\n\n`);
                }
            }
        }
        res.write('data: [DONE]\n\n');
        res.end();
    });

    remoteRes.on('error', e => {
        res.write(`data: ${JSON.stringify({ error: { message: e.message } })}\n\n`);
        res.end();
    });
}

async function collectFromCodexResponse(remoteRes, originalModel) {
    return new Promise((resolve, reject) => {
        let buffer = '';
        let eventName = '';
        let lastResponse = null;
        let accumulatedText = '';
        let toolCalls = [];
        let usage = null;
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
                        if (eventName === 'response.output_text.delta' || eventName === 'response.content_part.delta') {
                            if (parsed.delta) accumulatedText += parsed.delta;
                            else if (parsed.text) accumulatedText += parsed.text;
                        } else if (eventName === 'response.output_item.added' || eventName === 'response.output_item.done') {
                            if (parsed.item && parsed.item.type === 'function_call') {
                                toolCalls.push({
                                    id: parsed.item.call_id || ('call_' + crypto.randomUUID().substring(0, 8)),
                                    type: 'function',
                                    function: {
                                        name: parsed.item.name,
                                        arguments: typeof parsed.item.arguments === 'string' ? parsed.item.arguments : JSON.stringify(parsed.item.arguments || {}),
                                    },
                                });
                            }
                        } else if (eventName === 'response.completed' || eventName === 'response.done') {
                            if (parsed.response) {
                                lastResponse = parsed.response;
                                if (parsed.response.usage) usage = parsed.response.usage;
                            }
                        }
                    } catch (e) { }
                }
            }
        });
        remoteRes.on('end', () => {
            resolve({
                id: 'chatcmpl-' + (lastResponse?.id || crypto.randomUUID()),
                object: 'chat.completion',
                created: Math.floor((lastResponse?.created_at || Date.now() / 1000)),
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
                    total_tokens: usage.total_tokens || 0,
                } : undefined,
            });
        });
        remoteRes.on('error', reject);
    });
}

async function chatCompletion({ model, messages, stream, max_tokens, temperature, top_p, tools, tool_choice }, res) {
    const auth = await getAuth();
    if (!auth) {
        throw new Error('Codex auth unavailable. Run `codex` and log in with ChatGPT.');
    }
    // Codex/ChatGPT requires stream=true; we always stream internally
    const body = buildRequest({ model, messages, max_tokens, temperature, top_p, tools, tool_choice, stream: true });

    if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const remoteRes = await codexRequest({ token: auth.access, accountId: auth.accountId, body, stream: true });
        if (remoteRes.statusCode !== 200) {
            let errBody = '';
            remoteRes.on('data', c => errBody += c);
            remoteRes.on('end', () => {
                res.write(`data: ${JSON.stringify({ error: { message: `Codex ${remoteRes.statusCode}: ${errBody.substring(0, 300)}` } })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
            });
            return;
        }
        streamFromCodexResponse(remoteRes, model, res);
    } else {
        // Non-streaming: still call with stream=true, then collect
        const remoteRes = await codexRequest({ token: auth.access, accountId: auth.accountId, body, stream: true });
        if (remoteRes.statusCode !== 200) {
            let errBody = '';
            remoteRes.on('data', c => errBody += c);
            remoteRes.on('end', () => {
                res.status(remoteRes.statusCode).json({ error: { message: `Codex ${remoteRes.statusCode}: ${errBody.substring(0, 300)}` } });
            });
            return;
        }
        const final = await collectFromCodexResponse(remoteRes, model);
        res.json(final);
    }
}

module.exports = { chatCompletion, DEFAULT_MODELS };
