---
name: Bug report
about: Something is broken or not working as expected
title: "[Bug] "
labels: bug
---

## What happened

<!-- A clear, one-line description of the bug. -->

## Steps to reproduce

1. `cursor-noodle start`
2. Open Cursor, pick model X
3. Type "hello"
4. See error Y

## Expected behavior

<!-- What you expected to happen. -->

## Actual behavior

<!-- What actually happened. Include the full error message if any. -->

## Environment

- OS: <!-- macOS 14 / Ubuntu 22.04 / Windows 11 + WSL2 -->
- Node.js version: <!-- `node --version` -->
- Cursor version: <!-- Help → About -->
- `cursor-noodle --version`: <!-- output -->
- Which model ID were you using: <!-- e.g. `glm-4.6`, `minimax-m3`, `gemini-3-flash-medium` -->

## Logs

<!-- Run `cursor-noodle logs | tail -50` and paste the relevant lines here.
     If the request never reached the proxy, say so. -->

```
<paste here>
```

## `curl` reproduction (if any)

<!-- A `curl` command that reproduces the issue against http://localhost:6767/v1 -->

```bash
curl -s -X POST http://localhost:6767/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"...","messages":[{"role":"user","content":"hi"}]}'
```