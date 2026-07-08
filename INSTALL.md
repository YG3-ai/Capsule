# Capsule — Install & Run (macOS + Windows)

Capsule is a thin desktop app (Electron) around a static file server + a live
editor overlay + an MCP server the AI talks to. There's no build step for games;
the app just serves a project folder and loads `index.html?edit`.

## Prerequisites

- **Node.js 18+** and **npm** (`node -v`, `npm -v`).
- **git**.
- Optional, for the docked **AI box**: an agent CLI on your PATH — e.g. Claude
  Code: `npm i -g @anthropic-ai/claude-code` (the command is `claude`).

## Install & run the editor

```bash
cd app
npm install       # once — pulls Electron + node-pty (native, prebuilt)
npm start         # launches the desktop app
```

Then use the welcome screen: **New Project**, **Open Project…**, or **Browse**.
You can also open a project directly:

```bash
npm start -- "/absolute/path/to/project"      # macOS/Linux
npm start -- "C:\absolute\path\to\project"    # Windows — use a BACKSLASH path
# or: CAPSULE_PROJECT="…"  (env var)
```

Projects live under `~/Capsule` by default (configurable via
`config.projectsRoot`).

## Platform notes

### macOS
- The AI box runs your login shell (`$SHELL`, falling back to `/bin/zsh`).
- "Open in VS Code" uses `open -a "Visual Studio Code"`, falling back to the
  `code` CLI, then Finder.

### Windows
- The AI box runs `cmd.exe` (there's no `/bin/zsh`).
- **Do not launch Electron with `ELECTRON_RUN_AS_NODE=1` set.** Some shells /
  sandboxes export it; it makes Electron run as plain Node, so `require('electron')`
  returns a path string and the app crashes with `Cannot read properties of
  undefined (reading 'handle')`. Clear it first.
- Pass project paths to the CLI with **backslashes**. A forward-slash path can
  trip the static server's "inside the project?" check and show **Forbidden**.
  (The server now `path.resolve()`s the root to avoid this, but native paths are
  still safest.)
- Native modules (`node-pty`) ship prebuilt for `win32-x64` — no compiler needed.

## Running different kinds of games

Capsule serves a project folder and loads its `index.html?edit`. Two cases
beyond the built-in three.js templates:

- **A non-three.js / DOM game.** Capsule's `look`/`clear_markers`/`screenshot`
  MCP tools only need two things: a whole-window screenshot (generic) and a
  `window.capsule.editor` object on the page. So a plain HTML/CSS/JS game works
  if it exposes its own `window.capsule.editor` (with `lookingAt()` +
  `clearPins()`) when loaded with `?edit`. No three.js required.
- **A bundled game (Vite/TS/etc.).** Capsule runs no build step, so point it at
  the **built output** (e.g. Vite's `dist/`), which is plain HTML/JS/CSS. Keep
  developing in your source project and rebuild; Capsule previews `dist`. Have
  the game lazy-load its edit overlay only when `?edit` is present so it never
  ships in production.

## The MCP server

The editor is exposed to an AI over MCP at `http://127.0.0.1:39127/mcp`
(Streamable HTTP). Opening a project writes a `.mcp.json` into it pointing there,
so an agent run in that folder (the AI box, or your own Claude Code session)
gets the `look`, `clear_markers`, `move`, `save`, … tools.

See **[DEBUGGING.md](DEBUGGING.md)** if something doesn't come up.
