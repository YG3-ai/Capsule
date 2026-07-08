# Capsule — Debugging Playbook

A field guide to the failure modes we've hit (especially on Windows) and how to
diagnose them fast. Written so a fresh agent can get un-stuck without re-deriving
everything.

## How to see what's wrong

- **Main window DevTools:** View menu → Toggle Developer Tools.
- **AI box / terminal:** it's a separate `WebContentsView`. It now prints any
  startup error into the panel (via `window.onerror`) instead of sitting blank —
  read that text first.
- **Main-process logs:** run `npm start` from a terminal and watch stdout. The
  MCP server prints `[capsule] MCP server → http://127.0.0.1:39127/mcp` on boot;
  if you don't see it, `main.js` crashed before that line.

## Symptom → cause → fix

| Symptom | Cause | Fix |
|---|---|---|
| App exits instantly; `TypeError: Cannot read properties of undefined (reading 'handle')` at `ipcMain.handle` | `ELECTRON_RUN_AS_NODE=1` is set → Electron runs as plain Node, `require('electron')` returns a path string | Unset `ELECTRON_RUN_AS_NODE` before launching |
| Window shows **Forbidden** | Static-server "inside root?" check failed — project path used `/` while `path.join` produced `\` on Windows | `startServer` now `path.resolve()`s the root; pass native (backslash) paths |
| AI box blank / **"V8 platform does not support creating Workers"** | node-pty's Windows ConPTY backend spawns a Node Worker, which Electron **forbids in a renderer** | The PTY now runs in the **main process** and streams to xterm over IPC (`pty:spawn`/`pty:data`/`pty:input`/`pty:resize`) |
| AI box opens but nothing runs | Agent CLI not on PATH, or `$SHELL`/`/bin/zsh` assumed on Windows | Install the agent CLI (`npm i -g @anthropic-ai/claude-code`); the shell is now `cmd.exe` on Windows |
| MCP tool `look` returns **"Editor not attached"** | The loaded page doesn't expose `window.capsule.editor`, or it's not in `?edit` mode | Open the game with `?edit`; ensure the page (three.js overlay `capsule-edit.js`, or a DOM game's own overlay) sets `window.capsule.editor` |
| External agent can't see the tools | `.mcp.json` not present/loaded, or app not running | Ensure the project's `.mcp.json` points at `http://127.0.0.1:39127/mcp` and reconnect MCP after Capsule starts |

## Diagnostics you can run

**node-pty loads + spawns a shell (run under Electron's ABI):**
```bash
# from app/ — should print "node-pty loaded OK" and a shell prompt
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe -e "const p=require('node-pty');console.log('ok');p.spawn(process.env.COMSPEC||'cmd.exe',[],{cols:80,rows:24,cwd:'.',env:process.env})"
```

**MCP is up + a tool works (Streamable HTTP; `enableJsonResponse` is on so POST
returns JSON):**
```bash
# initialize → grab mcp-session-id header → tools/call look
curl -s -D- -o/dev/null -XPOST http://127.0.0.1:39127/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

## Architecture reminders (where things live)

- **Static server + preview:** `main.js` `startServer()` serves the project dir;
  the game loads via `win.loadURL(.../index.html?edit)` in the **main window**
  (not an iframe). Any request for `capsule-edit.js` is served from the canonical
  `app/template/capsule-edit.js`.
- **Editor API the MCP calls:** `window.capsule.editor` — `list`, `selected`,
  `selectById`, `setTransform`, `setLayer`, `save`, `lookingAt`, `clearPins`.
  The three.js overlay provides it; a DOM game must provide its own.
- **MCP:** `mcp.js`, HTTP on `:39127`. `look` = `capturePage()` (generic
  screenshot) + `lookingAt()` (page-specific).
- **AI box terminal:** `terminal.html` (xterm) ⇄ **main-process PTY** in
  `main.js` (`ptys` map, keyed by the sender `webContents`).

## Known future work

- **Best-fidelity Windows TUIs:** the PTY is ConPTY in the main process (good).
  If a very fussy TUI misbehaves, confirm `cwd`/env and cols/rows are forwarded.
- **VS Code / export on Windows:** `export/build.sh` is a bash script; Windows
  export needs a bash (Git Bash/WSL) or a `.ps1`/`.cmd` equivalent.
