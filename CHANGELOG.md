# Changelog

All notable changes to Capsule are recorded here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com/); dates are `YYYY-MM-DD`.

## [0.2.0] — 2026-06-29 — Mosaic, encapsulated assets & duplication

### Added

- **Mosaic — a visual moodboard.** A per-project Milanote-style board for collecting visual
  direction: drag in concept art, screenshots and storyboards on a freeform canvas, add note
  and link cards, and organize multiple boards (folders) per project. Reach it from the welcome
  screen, the editor (the `❏` button), the play bar, or **⌘⇧M**.
  - **"Reference in chat"** types a prompt like `Take a look at the reference images in
    ./mosaic/<board>/ (clara.png, …) and ` straight into the live AI box, so the model designs
    from the screenshots you curated — not just text.
  - **Design-first flow.** Open Mosaic with no project to get a chooser: open one of your
    projects' boards, or start an **empty game** and build the moodboard before a line of code.
  - Everything is plain files — images live in `mosaic/<board>/`, layout in a readable
    `mosaic.json` — so any agent reads your references the same way it reads the rest of the game.
- **`capsule.add(obj, opts)` — the standard way to add an asset.** Tags the object editable and
  wires its *attributes* so they move with it: `collide` (a following collision box, queried via
  `capsule.blocked(x, z)`), `light` and `sound` (scene-graph children that follow), and
  `behavior` (a per-frame fn run by `capsule.tick(dt)`). Extend with your own attribute kinds via
  `capsule.component(name, fn)`. Built into the 3D and 2D templates and documented in the
  template `CLAUDE.md` / `AGENTS.md`.
- **Duplicate any prop in the editor** — including code-built `Group`s — via per-row controls,
  the ＋Add menu, or `D`. Duplicates of procedural props are persisted as readable `clone`
  descriptors in `capsule.scenes.json` and reproduced by cloning the live source on load.
- **Point the AI at your view — `look` + reference pins.** A `look` MCP tool returns a screenshot
  of the user's current editor view plus the object centred under the crosshair and the editables
  on-screen. The new `◎` toolbar mode drops numbered **reference pins** on surfaces ("I mean
  *this*"); `look` reports each pin's world point and nearest editable, and `clear_markers` (or
  ⇧-click `◎`) removes them.

### Changed

- **Assets encapsulate their attributes, and collision follows them.** New `addPropBoundFor`
  "following bounds" track an object's live position, so moving or duplicating a tagged asset in
  the editor moves its collision (and its child light/sound) with it.
- **Game export excludes the moodboard.** `export/build.sh` and `mobile-export/build.sh` now skip
  `mosaic/` and `mosaic.json` — visual direction is dev-only and never ships inside the game.
- **New projects scaffold their own `mosaic/`** moodboard with a default board; older projects
  create one on first open. Per-project — never shared.

### Fixed

- **Mannequin collision** in the demo: collision is now registered *with* each figure as it's
  placed (no more invisible walls where progressively-spawned figures haven't appeared yet) and
  follows the figure when it's moved in the editor.

## [0.1.0] — 2026-06-23 — Editor foundation

### Added

- **The viewport editor.** Select, move, rotate and scale objects with gizmos; placements save
  back to a readable `capsule.scenes.json`, never an opaque blob.
- **Scenes & states**, tag/type/detector conventions, **mesh mode** for editing walls and floors,
  and **texture / color** editing on any material.
- **App chrome:** welcome screen, New Project (2D / 3D · PC / Mobile), a projects browser, a
  `~/Capsule` projects home, and "import existing project."
- **Embedded AI box** (bring your own agent — Claude Code, Codex, aider…) and **Open in VS Code**.
- **Drag-and-drop asset import** — drop a `.glb` / texture / audio file straight into the project.
- **Native export** to macOS, Windows and Linux via an Electron shell (`export/build.sh`), plus a
  Capacitor **mobile export** scaffold.
