# Capsule editor — desktop app

Opens a Capsule project, serves it over an embedded localhost server, loads the game's
`?edit` view (the editor overlay), **saves placements straight to disk** (no file picker),
opens the project in **VS Code**, hosts an **MCP server** so an AI agent can see + drive the
editor, and runs that agent in a built-in **AI box** (terminal pane).

## Develop (fast loop — no packaging)

```bash
npm install                 # first time
npx @electron/rebuild -w node-pty   # first time: build the native terminal module for Electron
npm start                   # opens a project picker
npm start -- /path/to/game  # …or open a project directly (also launches VS Code)
```

Edit `main.js` / `mcp.js` / `terminal.html` / `preload.js`, then `Ctrl+C` and `npm start`
again. This is the loop to use while building the app itself.

## Package & repackage (the .dmg)

```bash
npm run dist:mac     # → dist/Capsule-<version>.dmg   (and dist:win / dist:linux)
```

That's the whole repackage loop: **edit the app source → `npm run dist:mac` → new `.dmg`.**
electron-builder rebuilds the native `node-pty` for the target automatically. ~1–2 min.

> **You rarely need to repackage.** Editing a *game* needs no rebuild — games load
> dynamically; just edit and reload in the app (`Cmd+R`). Only changes to the *app's own*
> code (`main.js`, the overlay, the terminal) require `npm run dist:mac`.

`--dir` builds an unpacked `.app` (faster) for testing: `npx electron-builder --dir`.

## Pieces

| File | Role |
|------|------|
| `main.js` | window, embedded server, project open, save-to-disk IPC, VS Code, Play/Edit, AI box |
| `mcp.js` | MCP server (`list_editables`, `select`, `move`, `set_layer`, `save`, `screenshot`) |
| `terminal.html` | the AI box — xterm + node-pty pane running the configured agent CLI |
| `preload.js` | the renderer↔disk bridge (`capsuleHost.saveScenes`, …) |
| `prompt.html` | small modal text input (custom agent command) |

## AI box & MCP

On project open the app writes a `.mcp.json` (if absent) pointing Claude Code / Codex at the
editor's MCP server (`http://127.0.0.1:39127/mcp`). **AI Box** (`Cmd+J`) runs the agent set in
**Set AI Agent…** (`claude` default; `claude --continue` to resume your last conversation;
`codex` / `aider` / custom). The agent sees and drives the live editor through the MCP.

## Notes

- Unsigned build (`mac.identity: null`) — fine for local use; add a signing identity for
  distribution. No app icon yet (`mac.icon`).
- `node-pty` is native: a fresh `npm install` needs the `@electron/rebuild` step above.
