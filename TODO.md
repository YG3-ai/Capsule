# Capsule — TODO

Deferred items, roughly grouped. Not in priority order.

## Editor

- [ ] **Multi-page scene launcher** — reads `capsule.json`, lists scenes, opens each scene's
      `?edit` page. Makes Pattern A (one page per scene) a first-class flow instead of hand-
      navigating URLs. (See GUIDE.md Step 4.)
- [ ] **Full-bright editing toggle** — force every editable visible + lit while editing, so dark
      loops (blackout) and hidden entities (balcony watcher) are actually placeable.
- [ ] **Link Folder on first save** — `editor.html` defaults to Documents on first save; prompt
      to link the project folder instead.
- [ ] **Triage the ⚠ untagged list** — the untagged detector surfaces candidates; the *game*
      still needs each tagged (or a detector written). For theConsumed: ~30 GLBs to triage.

## Runtime / authoring

- [ ] **Extract `capsule-runtime.js`** — the `window.capsule` hook is copy-paste in GUIDE.md.
      Ship it as an importable module so a project is one import, not a pasted block.
- [ ] **Collision follows edits** — moving a prop moves its visual but not its collision
      footprint (bounds are baked at the authored position). Recompute from the live transform.

## theConsumed (the adapted clone)

- [ ] Wire `foodCourt` / `pavilion` scenes editable (currently only `deadMall` is set up).

## Export

- [ ] **Real installers for win / linux** — only `mac` (.dmg) and `dir` are verified; `win`
      (.exe) and `linux` (.AppImage) from a Mac need Wine / Docker.
- [ ] **GLB filename de-dup on import** — two different `tree.glb`s would overwrite in
      `assets/models/`.

## AI integration

- [ ] **Capsule MCP server** — expose the live editor to Claude Code as MCP tools:
      `list_editables`, `get_selection`, `select`, `move/rotate/scale` (with undo),
      `set_layer`, `save`, and crucially `screenshot` (so Claude can *see* the viewport).
      The app's main process hosts the MCP server and bridges to the editor via IPC. Lets
      Claude read + drive the scene from wherever it runs — the high-leverage first step.
- [ ] **Embedded Claude session in the app** — a chat panel inside the Capsule window (spawn
      `claude` in a pane, or the Agent SDK) so you don't switch to VS Code/terminal. Heavier;
      do the MCP first.

## Product / distribution

- [x] **Desktop app** (`app/`) — Electron editor: opens a project, serves it, attaches the
      overlay, **saves straight to disk (no picker)**, opens VS Code on the project. MVP works.
- [ ] **Package the app** for download — `app/` has `electron-builder` config; build + verify
      the `.dmg` / `.exe` / `.AppImage` (heavy; only the dev run is verified so far).
- [ ] **Welcome screen** — the app currently opens the picker on launch; a proper start screen
      with recent projects would be nicer.
- [ ] **Auto-inject the overlay** — the app serves the game as-is, so the game still needs the
      `window.capsule` hook + `capsule-edit.js` in its source. Having the app inject the overlay
      (game only exposes the scene) would remove the last copied code.
