const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const { getAuthCandidates } = require('../auth/antigravity.cjs');

// Parse Google-style tool calls like read(path="foo") into JSON
function parseGoogleToolExpression(expr) {
    const match = expr.match(/(\w+)\s*\(([\s\S]*)\)/);
    if (!match) return null;
    const name = match[1];
    const argsStr = match[2];
    const args = {};
    const argRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\[[\s\S]*?\])|(\{[\s\S]*?\})|(\d+)|(true|false|null))/g;
    let argMatch;
    while ((argMatch = argRegex.exec(argsStr)) !== null) {
        const key = argMatch[1];
        let val = argMatch[2] || argMatch[3] || argMatch[4] || argMatch[5] || argMatch[6] || argMatch[7];
        if (argMatch[6]) val = Number(val);
        else if (argMatch[7]) {
            if (val === 'true') val = true;
            else if (val === 'false') val = false;
            else if (val === 'null') val = null;
        } else if (argMatch[4] || argMatch[5]) {
            try { val = JSON.parse(val.replace(/'/g, '"')); } catch (e) { }
        }
        args[key] = val;
    }
    return { name, args };
}

const SYSTEM_INSTRUCTION = 'You are an expert coding assistant. Help the user with their coding tasks. Be direct, concise, and accurate.';

const STANDARD_TOOLS = {
    'ls': { name: 'ls', description: 'List files in a directory', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
    'read_file': { name: 'read_file', description: 'Read content of a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
    'write_file': { name: 'write_file', description: 'Write content to a file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } },
    'run_command': { name: 'run_command', description: 'Run a shell command', parameters: { type: 'object', properties: { command: { type: 'string' } } } },
    'Agent': { name: 'Agent', description: 'Run a subagent task', parameters: { type: 'object', properties: { prompt: { type: 'string' } } } },
};

// Maps Cursor-facing model IDs to actual Antigravity API model names.
const MODEL_MAPPING = {
    'ag-pro': 'gemini-3.1-pro-high',
    'ag-flash': 'gemini-3-flash',
    'ag-sonnet': 'claude-sonnet-4-6',
    'ag-opus': 'claude-opus-4-6-thinking',

    'gemini-3-flash-medium': 'gemini-3-flash',
    'gemini-3-flash-high': 'gemini-3-flash',
    'gemini-3-flash-low': 'gemini-3-flash',
    'gemini-3-flash': 'gemini-3-flash',
    'gemini-3.5-flash-medium': 'gemini-3-flash',
    'gemini-3.5-flash-high': 'gemini-3-flash',
    'gemini-3.5-flash-low': 'gemini-3-flash',
    'gemini-3.5-flash': 'gemini-3-flash',

    'gemini-3.1-pro-low': 'gemini-3.1-pro-low',
    'gemini-3.1-pro-high': 'gemini-3.1-pro-low',
    'gemini-3.1-pro-medium': 'gemini-3.1-pro-low',
    'gemini-3.1-pro': 'gemini-3.1-pro-low',

    'gemini-3-pro-low': 'gemini-3-pro-low',
    'gemini-3-pro-high': 'gemini-3-pro-high',
    'gemini-3-pro': 'gemini-3-pro-high',

    'claude-sonnet-4-6': 'claude-sonnet-4-6',
    'claude-sonnet-4-6-thinking': 'claude-sonnet-4-6',
    'claude-opus-4-6': 'claude-opus-4-6-thinking',
    'claude-opus-4-6-thinking': 'claude-opus-4-6-thinking',

    'gpt-oss-120b-medium': 'gpt-oss-120b-medium',
    'gpt-oss-120b': 'gpt-oss-120b-medium',

    'gpt-4o': 'gemini-3.1-pro-low',
    'gpt-4o-mini': 'gemini-3-flash',
    'gemini-1.5-flash': 'gemini-3-flash',
    'gemini-1.5-pro': 'gemini-3.1-pro-low',
};

function buildRequest({ targetModel, originalModel, messages, max_tokens, temperature, top_p, top_k, stop, tools, tool_choice }) {
    let systemInstructionText = SYSTEM_INSTRUCTION;
    const infoMessages = messages.filter(m => m.role === 'system');
    if (infoMessages.length > 0) {
        systemInstructionText += "\n\n" + infoMessages.map(m => m.content).join("\n\n");
    }

    const toolIdToName = new Map();
    const usedToolNames = new Set();
    const chatMessages = messages.filter(m => m.role !== 'system');

    const contents = chatMessages.map(m => {
        let parts = [];

        if (m.role === 'tool') {
            const name = m.name || toolIdToName.get(m.tool_call_id) || 'run_command';
            usedToolNames.add(name);
            parts = [{ functionResponse: { name, response: { content: m.content || '' } } }];
            return { role: 'user', parts };
        }

        if (Array.isArray(m.content)) {
            parts = m.content.map(p => {
                if (p.type === 'text') return { text: p.text };
                if (p.type === 'image_url' && p.image_url && p.image_url.url) {
                    const match = p.image_url.url.match(/^data:(image\/\w+);base64,(.+)$/);
                    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
                }
                return null;
            }).filter(p => p !== null);
        } else if (m.content) {
            parts = [{ text: m.content }];
            if (m.role === 'assistant') {
                const toolMatches = [...m.content.matchAll(/<tool_code>([\s\S]*?)<\/tool_code>/g)];
                for (const match of toolMatches) {
                    const parsed = parseGoogleToolExpression(match[1].trim());
                    if (parsed) {
                        usedToolNames.add(parsed.name);
                        parts.push({ functionCall: { name: parsed.name, args: parsed.args } });
                    }
                }
            }
        }

        if (m.tool_calls && m.role === 'assistant') {
            m.tool_calls.forEach(tc => {
                if (tc.type === 'function') {
                    if (tc.id) toolIdToName.set(tc.id, tc.function.name);
                    try {
                        usedToolNames.add(tc.function.name);
                        const args = JSON.parse(tc.function.arguments);
                        parts.push({ functionCall: { name: tc.function.name, args } });
                    } catch (e) {
                        const parsed = parseGoogleToolExpression(tc.function.arguments.trim());
                        if (parsed) {
                            usedToolNames.add(parsed.name);
                            parts.push({ functionCall: { name: parsed.name, args: parsed.args } });
                        } else {
                            parts.push({ functionCall: { name: tc.function.name, args: { _raw: tc.function.arguments.substring(0, 1000) } } });
                        }
                    }
                }
            });
        }

        return { role: m.role === 'assistant' ? 'model' : 'user', parts: parts.length > 0 ? parts : [{ text: '' }] };
    });

    // Inject thought signatures for tool calls
    for (const content of contents) {
        if (content.role === 'model') {
            for (const part of content.parts) {
                if (part.functionCall && !part.thoughtSignature) {
                    part.thoughtSignature = 'context_engineering_is_the_way_to_go';
                }
            }
        }
    }

    const requestObj = {
        contents,
        systemInstruction: { parts: [{ text: systemInstructionText }] },
        generationConfig: {
            maxOutputTokens: max_tokens || 8192,
            temperature: temperature !== undefined ? temperature : 0.7,
            topP: top_p,
            topK: top_k,
            stopSequences: Array.isArray(stop) ? stop : (stop ? [stop] : undefined),
        },
    };

    // Add thinking config for Gemini 3 Flash
    const isGemini3Flash = targetModel === 'gemini-3-flash';
    const isClaudeSonnetNonThinking = targetModel === 'claude-sonnet-4-6';

    if (isGemini3Flash) {
        const tierMatch = originalModel.match(/-(minimal|low|medium|high)$/);
        requestObj.generationConfig.thinkingConfig = {
            includeThoughts: false,
            thinkingLevel: tierMatch ? tierMatch[1] : 'medium',
        };
    } else if (targetModel.includes('claude-opus-4-6-thinking')) {
        requestObj.generationConfig.thinkingConfig = { includeThoughts: true, thinkingBudget: 16384 };
        const effectiveMax = max_tokens || 8192;
        if (effectiveMax <= 16384) requestObj.generationConfig.maxOutputTokens = 20480;
    }

    // Tool declarations
    const declarations = [];
    const seenDecls = new Set();
    if (tools) {
        tools.forEach(t => {
            // Cursor sometimes sends tools in OpenAI shape {function: {name,...}},
            // sometimes flat {name, description, parameters}. Be defensive.
            const fn = t.function || t;
            if (!fn || !fn.name) return;
            declarations.push({ name: fn.name, description: fn.description || '', parameters: fn.parameters || { type: 'object', properties: {} } });
            seenDecls.add(fn.name);
        });
    }
    usedToolNames.forEach(name => {
        if (!seenDecls.has(name)) {
            declarations.push(STANDARD_TOOLS[name] || { name, description: `Helper tool ${name}`, parameters: { type: 'object', properties: {} } });
            seenDecls.add(name);
        }
    });
    if (declarations.length > 0) {
        requestObj.tools = [{ functionDeclarations: declarations }];
    }
    if (tool_choice && typeof tool_choice === 'object') {
        const choiceName = (tool_choice.function && tool_choice.function.name) || tool_choice.name;
        if (choiceName) {
            requestObj.toolConfig = {
                functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [choiceName] },
            };
        }
    }

    return requestObj;
}

function makeRequest({ token, project, targetModel, requestObj }) {
    const payload = {
        project, model: targetModel, request: requestObj,
        userAgent: 'antigravity', requestType: 'agent',
        requestId: 'agent-' + crypto.randomUUID(),
    };
    const remoteUrl = process.env.ANTIGRAVITY_ENDPOINT ||
        'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse';

    return new Promise((resolve, reject) => {
        const req = https.request(remoteUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'antigravity/1.15.8 windows/amd64',
                'Accept': 'text/event-stream',
            },
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    const err = new Error(`Antigravity ${res.statusCode}: ${data.substring(0, 500)}`);
                    err.statusCode = res.statusCode;
                    err.body = data;
                    return reject(err);
                }
                resolve(data);
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify(payload));
        req.end();
    });
}

function streamRequest({ token, project, targetModel, requestObj }) {
    const payload = {
        project, model: targetModel, request: requestObj,
        userAgent: 'antigravity', requestType: 'agent',
        requestId: 'agent-' + crypto.randomUUID(),
    };
    const remoteUrl = process.env.ANTIGRAVITY_ENDPOINT ||
        'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse';

    return new Promise((resolve, reject) => {
        const req = https.request(remoteUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'antigravity/1.15.8 windows/amd64',
                'Accept': 'text/event-stream',
            },
        }, (res) => {
            if (res.statusCode !== 200) {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    const err = new Error(`Antigravity ${res.statusCode}: ${body.substring(0, 500)}`);
                    err.statusCode = res.statusCode;
                    err.body = body;
                    reject(err);
                });
                return;
            }
            resolve(res);
        });
        req.on('error', reject);
        req.write(JSON.stringify(payload));
        req.end();
    });
}

// Parse the SSE response from antigravity into OpenAI chat completion chunks
function makeStreamingTransformer(originalModel) {
    let sentToolCallIds = new Set();
    let anyToolCallEmitted = false;  // Antigravity often returns finishReason=STOP even when it called a tool; track manually.
    let lastUsageMetadata = null;
    let buffer = '';
    let onChunk = null;

    function processChunk(chunk) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            if (line.startsWith('data:')) {
                const rawData = line.substring(5).trim();
                if (!rawData) continue;
                try {
                    const responseData = JSON.parse(rawData);
                    if (responseData.response?.usageMetadata) {
                        lastUsageMetadata = responseData.response.usageMetadata;
                    }
                    const candidates = responseData.response?.candidates || [];
                    for (const cand of candidates) {
                        const parts = cand.content?.parts || [];
                        const finishReason = cand.finishReason;
                        for (let i = 0; i < parts.length; i++) {
                            const part = parts[i];
                            if (part.text) {
                                const evt = {
                                    id: 'chatcmpl-' + crypto.randomUUID(),
                                    object: 'chat.completion.chunk',
                                    created: Math.floor(Date.now() / 1000),
                                    model: originalModel,
                                    choices: [{
                                        index: 0,
                                        delta: { content: part.text },
                                        finish_reason: null,
                                    }],
                                };
                                if (onChunk) onChunk(evt);
                            }
                            if (part.functionCall) {
                                const callHash = crypto.createHash('md5')
                                    .update(part.functionCall.name + JSON.stringify(part.functionCall.args))
                                    .digest('hex');
                                if (!sentToolCallIds.has(callHash)) {
                                    sentToolCallIds.add(callHash);
                                    anyToolCallEmitted = true;
                                    const callId = 'call_' + crypto.randomUUID().substring(0, 8);
                                    const argsStr = JSON.stringify(part.functionCall.args || {});
                                    // Start
                                    if (onChunk) onChunk({
                                        id: 'chatcmpl-' + crypto.randomUUID(),
                                        object: 'chat.completion.chunk',
                                        created: Math.floor(Date.now() / 1000),
                                        model: originalModel,
                                        choices: [{
                                            index: 0,
                                            delta: { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: part.functionCall.name, arguments: '' } }] },
                                            finish_reason: null,
                                        }],
                                    });
                                    // Sliced args
                                    for (let j = 0; j < argsStr.length; j += 120) {
                                        const slice = argsStr.substring(j, j + 120);
                                        if (onChunk) onChunk({
                                            id: 'chatcmpl-' + crypto.randomUUID(),
                                            object: 'chat.completion.chunk',
                                            created: Math.floor(Date.now() / 1000),
                                            model: originalModel,
                                            choices: [{
                                                index: 0,
                                                delta: { tool_calls: [{ index: 0, function: { arguments: slice } }] },
                                                finish_reason: null,
                                            }],
                                        });
                                    }
                                }
                            }
                        }
                        if (finishReason) {
                            // If we emitted any tool calls in this response, the real
                            // finish_reason is tool_calls even if Antigravity said STOP.
                            let mapped;
                            if (anyToolCallEmitted) {
                                mapped = finishReason === 'MAX_TOKENS' ? 'length' : 'tool_calls';
                            } else {
                                mapped = finishReason === 'STOP' ? 'stop' :
                                    finishReason === 'TOOL_USE' ? 'tool_calls' :
                                    finishReason === 'MAX_TOKENS' ? 'length' : finishReason;
                            }
                            if (onChunk) onChunk({
                                id: 'chatcmpl-' + crypto.randomUUID(),
                                object: 'chat.completion.chunk',
                                created: Math.floor(Date.now() / 1000),
                                model: originalModel,
                                choices: [{ index: 0, delta: {}, finish_reason: mapped }],
                            });
                        }
                    }
                } catch (e) { }
            }
        }
    }

    function finish() {
        if (lastUsageMetadata) {
            const evt = {
                id: 'chatcmpl-' + crypto.randomUUID(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: originalModel,
                choices: [],
                usage: {
                    prompt_tokens: lastUsageMetadata.promptTokenCount,
                    completion_tokens: lastUsageMetadata.candidatesTokenCount,
                    total_tokens: lastUsageMetadata.totalTokenCount,
                },
            };
            if (onChunk) onChunk(evt);
        }
    }

    return {
        setOnChunk(fn) { onChunk = fn; },
        processChunk,
        finish,
    };
}

function isRetryableAccountError(error) {
    const status = error?.statusCode;
    const msg = String(error?.body || error?.message || '');
    if ([401, 403, 429].includes(status)) return true;
    if (status >= 500) return true;
    return /quota|rate.?limit|usage.?limit|billing|payment|insufficient|exhausted|permission|unauthorized|forbidden/i.test(msg);
}

async function openAntigravityStream(auths, targetModel, requestObj) {
    const errors = [];
    for (let i = 0; i < auths.length; i++) {
        const auth = auths[i];
        try {
            const remoteRes = await streamRequest({ token: auth.access, project: auth.projectId, targetModel, requestObj });
            return { remoteRes, auth };
        } catch (e) {
            errors.push(`account ${i + 1}: ${e.message}`);
            if (!isRetryableAccountError(e)) break;
            console.log(`[antigravity] account ${i + 1} failed; trying next account`);
        }
    }
    const e = new Error(errors.join('\n'));
    e.statusCode = /429|rate|quota|limit|exhausted/i.test(e.message) ? 429 : (/401|403|auth|unauthorized|forbidden/i.test(e.message) ? 401 : 500);
    throw e;
}

async function openAntigravityBody(auths, targetModel, requestObj) {
    const errors = [];
    for (let i = 0; i < auths.length; i++) {
        const auth = auths[i];
        try {
            const body = await makeRequest({ token: auth.access, project: auth.projectId, targetModel, requestObj });
            return { body, auth };
        } catch (e) {
            errors.push(`account ${i + 1}: ${e.message}`);
            if (!isRetryableAccountError(e)) break;
            console.log(`[antigravity] account ${i + 1} failed; trying next account`);
        }
    }
    const e = new Error(errors.join('\n'));
    e.statusCode = /429|rate|quota|limit|exhausted/i.test(e.message) ? 429 : (/401|403|auth|unauthorized|forbidden/i.test(e.message) ? 401 : 500);
    throw e;
}

async function chatCompletion({ model, messages, stream, max_tokens, temperature, top_p, top_k, stop, tools, tool_choice }, res) {
    const auths = await getAuthCandidates();
    if (auths.length === 0) {
        throw new Error('Antigravity auth unavailable. Run `cursor-noodle setup` and sign in.');
    }
    const targetModel = MODEL_MAPPING[model] || model;
    const requestObj = buildRequest({ targetModel, originalModel: model, messages, max_tokens, temperature, top_p, top_k, stop, tools, tool_choice });

    if (stream) {
        const { remoteRes } = await openAntigravityStream(auths, targetModel, requestObj);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const transformer = makeStreamingTransformer(model);
        transformer.setOnChunk(evt => res.write(`data: ${JSON.stringify(evt)}\n\n`));
        remoteRes.on('data', chunk => transformer.processChunk(chunk));
        remoteRes.on('end', () => {
            transformer.finish();
            res.write('data: [DONE]\n\n');
            res.end();
        });
        remoteRes.on('error', e => {
            res.write(`data: ${JSON.stringify({ error: { message: e.message } })}\n\n`);
            res.end();
        });
    } else {
        const { body } = await openAntigravityBody(auths, targetModel, requestObj);
        let fullText = '';
        let toolCalls = [];
        const lines = body.split('\n');
        for (const line of lines) {
            if (line.startsWith('data:')) {
                try {
                    const data = JSON.parse(line.substring(5).trim());
                    const parts = data.response?.candidates?.[0]?.content?.parts || [];
                    for (const part of parts) {
                        if (part.text) fullText += part.text;
                        if (part.functionCall) {
                            toolCalls.push({
                                id: 'call_' + crypto.randomUUID().substring(0, 8),
                                type: 'function',
                                function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) },
                            });
                        }
                    }
                } catch (e) { }
            }
        }
        res.json({
            id: 'chatcmpl-' + crypto.randomUUID(),
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: fullText,
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                },
                finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
            }],
        });
    }
}

module.exports = { chatCompletion, MODEL_MAPPING };
