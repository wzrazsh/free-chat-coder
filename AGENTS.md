# AGENTS.md

## Project overview

`free-chat-coder` — local AI dev toolkit around DeepSeek with a Chrome extension, task queue, and web console. Two execution channels: server-side `deepseek-web` provider (direct API calls) and `extension-dom` provider (Chrome extension DOM manipulation).

## Architecture

```
Web Console (Vite+React, port 5173)  ←WebSocket/HTTP→  Queue Server (Express, port 8080→8090)
                                                                │
                                            deepseek-web          extension-dom
                                            (server-side API)     (Chrome extension)
```

Key directories:
- `queue-server/` — Express backend, task queue, WebSocket, providers (CommonJS)
- `web-console/` — Vite + React + TypeScript + Tailwind 4 frontend (ESM)
- `chromevideo/` — Chrome MV3 extension (content scripts, service worker, side panel)
- `shared/` — CommonJS config & queue server discovery (used by both)
- `scripts/` — onboarding, provider verification, config sync, status report

## Commands

```bash
# Install (NOT a workspace — install each separately)
cd queue-server && npm install
cd ../web-console && npm install

# Dev servers (run in separate terminals)
cd queue-server && npm run dev        # nodemon, port 8080 (auto-fallback 8082–8090)
cd web-console && npm run dev         # vite, port 5173

# Build & lint (web-console only; queue-server has no lint/test)
cd web-console && npm run build
cd web-console && npm run lint

# Validate environment (run FIRST on any new machine)
node validate-environment.js
node validate-environment.js --profile .browser-profile

# DeepSeek auth onboarding (required for server-side provider)
node scripts/onboard-deepseek-web.js --profile .browser-profile

# Verify deepseek-web provider
node scripts/verify-deepseek-web-provider.js --prompt "Reply with exactly: FCC_DEEPSEEK_OK"

# Syntax-check JS files (no formal test suite for extension/queue-server)
node -c queue-server/index.js
node -c chromevideo/background.js
node -c chromevideo/offscreen.js
node -c chromevideo/sidepanel.js
```

## Critical gotchas

### content.js loads LAST and overwrites mode-controller.js
`manifest.json` content_scripts array loads `controllers/mode-controller.js` (line 42) before `content.js` (line 47). **`content.js` defines a full duplicate `window.ModeController`** that overwrites the earlier definition at runtime. The `mode-controller.js` version has `_toggleState` with a `style.color` null-safety check that the `content.js` version drops. Any changes to ModeController must go into `content.js` or the duplicate must be removed.

### setModelMode is a no-op (known bug → doc/tasks.md)
Both `content.js:70-73` and `mode-controller.js:101-111` define `setModelMode` that returns `{ success: true }` without clicking any DOM elements. The `deepthink_search_fallback` path in `setModeProfile` calls this dead method. See `doc/tasks.md` Bug 1.

### background.js bypasses content script routing for setModeProfile
`background.js:157-186` intercepts `setModeProfile` and uses `chrome.tabs.executeScript` instead of `chrome.tabs.sendMessage`. This means content script routing (line 128-129 of `content.js`) is dead code for this action.

### Queue Server auto-discovers port
All clients (web console, extension, offscreen, native host) call `/health` to find the actual Queue Server port. Never hardcode port 8080. Use `shared/queue-server.js` `discoverQueueServer()`.

### No workspace-level npm
Root `package.json` only lists `playwright` and `ws` as dependencies. Do not run `npm install` at root expecting to get queue-server or web-console deps.

### auth file is gitignored but critical
`queue-server/data/deepseek-web-auth.json` is in `.gitignore`. After onboarding, verify it exists before running provider tests.

### Windows / PowerShell
The developer environment is Windows with PowerShell 5.1. Commands using `&&` chaining will fail — use `; if ($?) { ... }` or run commands in separate calls with `workdir`.

## File conventions
- `queue-server/`: CommonJS (`require`/`module.exports`), no TypeScript
- `web-console/`: ESM (`import`/`export`), TypeScript strict mode, Tailwind 4
- `chromevideo/`: vanilla JS (no bundler), runs in browser extension context
- `shared/`: CommonJS, consumed by Node scripts and queue-server
- No trailing comments unless necessary (convention from codebase)
