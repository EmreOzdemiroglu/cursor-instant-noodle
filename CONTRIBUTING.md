# Contributing

Thanks for your interest in cursor-instant-noodle! 🍜

## Quick start

```bash
git clone https://github.com/EmreOzdemiroglu/cursor-instant-noodle
cd cursor-instant-noodle
npm install
node bin/cursor-noodle.cjs start
```

## Adding a new provider

Most providers are 50–100 lines of code. The pattern is:

1. **Auth loader** at `auth/<name>.cjs` exporting `getAuth()` that returns `{ apiKey, source }`. Read from env vars first, then fall back to known CLI tool auth files.
2. **Provider module** at `providers/<name>.cjs` exporting `chatCompletion({ model, messages, stream, ... }, res)`. Translate the OpenAI Chat Completions request into your provider's format and translate the response back.
3. **Wire it in** `proxy.cjs`:
   - Add the provider module to the `require()` block at the top
   - Add a route prefix in `detectProvider()` (the model ID prefix that selects this provider)
   - Add the dispatch branch in the `/v1/chat/completions` handler
4. **Add models** to the `MODELS` array in `proxy.cjs`
5. **Document it** in `docs/providers.md` and add the auth var to `.env.example`

### Translation cheat sheet

| Provider format | How to translate from OpenAI Chat Completions |
|---|---|
| **Anthropic Messages** | Extract `system`, convert messages to `{role, content: [...]}` blocks, map tool_use / tool_result |
| **OpenAI Responses** | Each user message → `input` items; each assistant message → `output` items; stream events map cleanly |
| **OpenAI-compatible** | Mostly passthrough; just swap base URL and API key |
| **Custom** (like Antigravity) | Reconstruct the provider's native request shape and parse their response format |

### Testing your provider

```bash
curl -s -X POST http://localhost:6767/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"your-model-id","messages":[{"role":"user","content":"hi"}],"stream":false}' \
  | jq '.choices[0].message.content'
```

Should return a string. If it returns empty, check `.cursor-noodle.log`.

For streaming:
```bash
curl -N -X POST http://localhost:6767/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"your-model-id","messages":[{"role":"user","content":"hi"}],"stream":true}'
```

Should print `data: { ... }` lines ending with `data: [DONE]`.

## Code style

- CommonJS (`.cjs`), no ESM
- 4-space indentation
- `const` over `let`
- Fail loudly with descriptive error messages — silent failures are worse than crashes for end users
- Always test with both `stream: true` and `stream: false`

## Pull request checklist

- [ ] Tested with `stream: true` and `stream: false`
- [ ] Added to `MODELS` array in `proxy.cjs`
- [ ] Documented in `docs/providers.md`
- [ ] Added to `.env.example` if it needs new env vars
- [ ] Updated `CHANGELOG.md`
- [ ] No `console.log` debug statements left behind

## Reporting bugs

Use the **Bug report** issue template. Include:
- OS and Node.js version
- Output of `cursor-noodle status`
- Output of `cursor-noodle logs | tail -50`
- The exact model ID you were using
- A minimal `curl` command that reproduces the issue

## License

By contributing, you agree that your contributions will be licensed under the MIT License.