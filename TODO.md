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

## AI integration — the "no learning curve" on-ramp

The product thesis: gizmos are the precision layer; an **AI box is the zero-learning entry**
— open your game, type "make it night and add a tree by the door," done. Three layers:

- [ ] **MCP (eyes + hands)** — the app's main process exposes the live editor as MCP tools:
      `list_editables`, `get_selection`, `select`, `move/rotate/scale` (with undo), `set_layer`,
      `save`, and crucially **`screenshot`** so Claude can *see* the viewport. Bridges to the
      editor via IPC. The enabler — build first.
- [ ] **AI box (chat panel in the app)** — the front door. A chat surface in the Capsule window
      (Claude Agent SDK session in the main process, streamed to a renderer panel), wired to the
      MCP so it can act on the scene.
- [ ] **Session continuity** — the box **resumes** the project's Claude Code session, so you
      continue the conversation you were having in VS Code. Hand-off model (resume), not two
      live clients on one session. Uses the user's existing Claude auth (bring-your-own).
      Prereqs: the desktop app (container) must be finished first.

## Research

- [ ] **Evaluate Cortexdb (or similar) as a memory layer** — for AI continuity across sessions.
      Need the actual repo/link to assess. Bar to clear: must beat "readable markdown context
      (CLAUDE/GUIDE/SCENES/TODO) + Claude Code native session resume + memory files," which is
      zero-dep and fits the moat. Would live in the editor/tooling side only — never inside the
      capsule games (those stay dependency-free).

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
