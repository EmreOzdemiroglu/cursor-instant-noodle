const https = require('https');
const crypto = require('crypto');
const { getAuthCandidates } = require('../auth/codex.cjs');

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

// Reasoning effort levels for the GPT-5 family. Each advertised model ID
// has a `-none`/`-light`/`-medium`/`-high`/`-xhigh` suffix that maps to one
// of these. Probed against the Codex backend: `none` disables reasoning
// cleanly, `minimal`/`max` are NOT accepted, only these 5 values work.
const REASONING_EFFORT = {
    'none': 'none',
    'light': 'low',
    'medium': 'medium',
    'high': 'high',
    'xhigh': 'xhigh',
};

// Strip a known reasoning suffix from the model ID and return the upstream
// model + the effort key. e.g. 'gpt-5.5-xhigh' -> { upstream: 'gpt-5.5', effort: 'xhigh' }.
// Falls back to medium for bare model IDs.
function resolveModelAndEffort(model) {
    for (const suffix of Object.keys(REASONING_EFFORT)) {
        if (model.endsWith('-' + suffix)) {
            return { upstream: model.slice(0, -(suffix.length + 1)), effort: suffix };
        }
    }
    return { upstream: model, effort: 'medium' };
}

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

    const { upstream, effort } = resolveModelAndEffort(model);
    const req = {
        model: DEFAULT_MODELS[upstream] || upstream,
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
    // Reasoning effort (probed valid values: none/low/medium/high/xhigh).
    req.reasoning = { effort: REASONING_EFFORT[effort] || 'medium' };

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

    // Track tool calls across the stream. Codex emits them as:
    //   response.output_item.added        (item with id, name, call_id, arguments='')
    //   response.function_call_arguments.delta (one or more deltas)
    //   response.function_call_arguments.done   (complete arguments string)
    //   response.output_item.done         (item with status=completed)
    // The final response.completed event has output=[] in Codex (backend quirk),
    // so we reconstruct tool_calls from the item events.
    const toolCalls = new Map(); // call_id -> { id, name, arguments, emitted }

    const id = (extra) => 'chatcmpl-' + (extra || crypto.randomUUID());
    const ts = () => Math.floor(Date.now() / 1000);
    const emitChunk = (choicesDelta, finishReason) => {
        res.write(`data: ${JSON.stringify({
            id: id(lastResponse?.id),
            object: 'chat.completion.chunk',
            created: ts(),
            model: originalModel,
            choices: [{ index: 0, delta: choicesDelta, finish_reason: finishReason || null }],
        })}\n\n`);
    };

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
                let parsed;
                try { parsed = JSON.parse(data); } catch (e) { continue; }

                if (eventName === 'response.output_text.delta' || eventName === 'response.content_part.delta') {
                    const delta = parsed.delta || parsed.text;
                    if (delta) emitChunk({ content: delta }, null);
                } else if (eventName === 'response.function_call_arguments.delta') {
                    const callId = parsed.item_id && toolCalls.get(parsed.item_id);
                    if (callId && parsed.delta) {
                        callId.arguments = (callId.arguments || '') + parsed.delta;
                    }
                } else if (eventName === 'response.function_call_arguments.done') {
                    // Codex's final arguments string — use it as the canonical value.
                    const callId = parsed.item_id && toolCalls.get(parsed.item_id);
                    if (callId && parsed.arguments) callId.arguments = parsed.arguments;
                } else if (eventName === 'response.output_item.added') {
                    if (parsed.item && parsed.item.type === 'function_call') {
                        const item = parsed.item;
                        toolCalls.set(item.id, {
                            id: item.id,
                            call_id: item.call_id,
                            name: item.name,
                            arguments: item.arguments || '',
                            emitted: false,
                        });
                        // OpenAI Chat Completions format: announce the tool call with its id/name first,
                        // then stream the arguments. We need to emit a chunk with the call index.
                        const idx = Array.from(toolCalls.keys()).indexOf(item.id);
                        emitChunk({
                            tool_calls: [{
                                index: idx,
                                id: item.call_id,
                                type: 'function',
                                function: { name: item.name, arguments: '' },
                            }],
                        }, null);
                    }
                } else if (eventName === 'response.output_item.done') {
                    if (parsed.item && parsed.item.type === 'function_call') {
                        const item = parsed.item;
                        const tc = toolCalls.get(item.id);
                        if (tc) {
                            // Use the done item's complete arguments (handles edge cases).
                            if (item.arguments) tc.arguments = item.arguments;
                            // Emit a final arguments chunk in case the deltas didn't cover everything.
                            const idx = Array.from(toolCalls.keys()).indexOf(item.id);
                            emitChunk({
                                tool_calls: [{
                                    index: idx,
                                    function: { arguments: tc.arguments || '' },
                                }],
                            }, null);
                            tc.emitted = true;
                        }
                    }
                } else if (eventName === 'response.completed' || eventName === 'response.done') {
                    if (parsed.response) {
                        lastResponse = parsed.response;
                    }
                }
            }
        }
    });

    remoteRes.on('end', () => {
        // If the model called any tools, finish with finish_reason='tool_calls'.
        // Otherwise 'stop'.
        const anyToolCalls = Array.from(toolCalls.values()).some(t => t.emitted);
        emitChunk({}, anyToolCalls ? 'tool_calls' : 'stop');

        if (lastResponse && lastResponse.usage) {
            const u = lastResponse.usage;
            res.write(`data: ${JSON.stringify({
                id: id(lastResponse.id),
                object: 'chat.completion.chunk',
                created: ts(),
                model: originalModel,
                choices: [],
                usage: {
                    prompt_tokens: u.input_tokens || 0,
                    completion_tokens: u.output_tokens || 0,
                    total_tokens: u.total_tokens || 0,
                },
            })}\n\n`);
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
        let usage = null;
        // Same reconstruction logic as the streaming path — Codex's
        // response.completed sometimes has output=[].
        const toolCalls = new Map(); // item_id -> { id, call_id, name, arguments }

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
                    let parsed;
                    try { parsed = JSON.parse(data); } catch (e) { continue; }

                    if (eventName === 'response.output_text.delta' || eventName === 'response.content_part.delta') {
                        if (parsed.delta) accumulatedText += parsed.delta;
                        else if (parsed.text) accumulatedText += parsed.text;
                    } else if (eventName === 'response.function_call_arguments.delta') {
                        const tc = parsed.item_id && toolCalls.get(parsed.item_id);
                        if (tc && parsed.delta) tc.arguments = (tc.arguments || '') + parsed.delta;
                    } else if (eventName === 'response.function_call_arguments.done') {
                        const tc = parsed.item_id && toolCalls.get(parsed.item_id);
                        if (tc && parsed.arguments) tc.arguments = parsed.arguments;
                    } else if (eventName === 'response.output_item.added') {
                        if (parsed.item && parsed.item.type === 'function_call') {
                            toolCalls.set(parsed.item.id, {
                                id: parsed.item.id,
                                call_id: parsed.item.call_id,
                                name: parsed.item.name,
                                arguments: parsed.item.arguments || '',
                            });
                        }
                    } else if (eventName === 'response.output_item.done') {
                        if (parsed.item && parsed.item.type === 'function_call') {
                            const existing = toolCalls.get(parsed.item.id) || {};
                            toolCalls.set(parsed.item.id, {
                                id: parsed.item.id,
                                call_id: parsed.item.call_id || existing.call_id,
                                name: parsed.item.name || existing.name,
                                arguments: parsed.item.arguments || existing.arguments || '',
                            });
                        }
                    } else if (eventName === 'response.completed' || eventName === 'response.done') {
                        if (parsed.response) {
                            lastResponse = parsed.response;
                            if (parsed.response.usage) usage = parsed.response.usage;
                        }
                    }
                }
            }
        });

        remoteRes.on('end', () => {
            const toolCallsArr = Array.from(toolCalls.values()).map((t, i) => ({
                id: t.call_id || ('call_' + crypto.randomUUID().substring(0, 8)),
                type: 'function',
                function: {
                    name: t.name,
                    arguments: t.arguments || '{}',
                },
            }));
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
                        tool_calls: toolCallsArr.length > 0 ? toolCallsArr : undefined,
                    },
                    finish_reason: toolCallsArr.length > 0 ? 'tool_calls' : 'stop',
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

function isRetryableAccountError(statusCode, body) {
    const msg = String(body || '');
    if ([401, 403, 429].includes(statusCode)) return true;
    if (statusCode >= 500) return true;
    return /quota|rate.?limit|usage.?limit|billing|payment|insufficient|exhausted|not supported with chatgpt account/i.test(msg);
}

function readResponseBody(remoteRes) {
    return new Promise(resolve => {
        let body = '';
        remoteRes.on('data', c => body += c);
        remoteRes.on('end', () => resolve(body));
        remoteRes.on('error', () => resolve(body));
    });
}

async function openCodexResponse(auths, body) {
    const errors = [];
    for (let i = 0; i < auths.length; i++) {
        const auth = auths[i];
        const remoteRes = await codexRequest({ token: auth.access, accountId: auth.accountId, body, stream: true });
        if (remoteRes.statusCode === 200) return { remoteRes, auth };
        const errBody = await readResponseBody(remoteRes);
        errors.push(`account ${i + 1}: Codex ${remoteRes.statusCode}: ${errBody.substring(0, 300)}`);
        if (!isRetryableAccountError(remoteRes.statusCode, errBody)) break;
        console.log(`[codex] account ${i + 1} failed (${remoteRes.statusCode}); trying next account`);
    }
    const e = new Error(errors.join('\n'));
    e.statusCode = /429|rate|quota|limit|exhausted/i.test(e.message) ? 429 : (/401|403|auth/i.test(e.message) ? 401 : 500);
    throw e;
}

async function chatCompletion({ model, messages, stream, max_tokens, temperature, top_p, tools, tool_choice }, res) {
    const auths = await getAuthCandidates();
    if (auths.length === 0) {
        const hint = process.env.CODEX_REFRESH_TOKEN
            ? 'Noodle-managed Codex credentials are present but could not be refreshed. Run `cursor-noodle setup` and sign in again'
            : `No Codex credentials found in ~/.cursor-noodle/.env. Run: cursor-noodle setup`;
        throw new Error(`Codex auth unavailable. ${hint}.`);
    }
    // Codex/ChatGPT requires stream=true; we always stream internally.
    const body = buildRequest({ model, messages, max_tokens, temperature, top_p, tools, tool_choice, stream: true });
    const { remoteRes } = await openCodexResponse(auths, body);

    if (stream) {
        // Only send streaming headers after an account succeeds. This lets us
        // silently fail over across accounts without leaking intermediate errors.
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        streamFromCodexResponse(remoteRes, model, res);
    } else {
        const final = await collectFromCodexResponse(remoteRes, model);
        res.json(final);
    }
}

module.exports = { chatCompletion, DEFAULT_MODELS };
