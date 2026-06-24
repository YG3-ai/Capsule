# Capsule

This repo is the **Capsule editor** — a thin visual layer over plain-text three.js games.

## Docs

- **[GUIDE.md](GUIDE.md)** — how to build or adapt a game so Capsule tracks its assets
  (the hook, tagging, naming, scenes, states, the editor workflow). Start here.
- **[SCENES.md](SCENES.md)** — the normative spec: scenes/states layering, file layout, the
  tag/type/detector conventions, and the locked naming rules.
- **[export/README.md](export/README.md)** — wrapping a capsule into a native executable.

## What Capsule is for

LLMs write three.js games top to bottom just fine. The HTML, the CSS, the game loop, the
shaders — all of it is readable text an agent can author and edit with no roadblocks. There is
no compile step to reason about, no bundler output to diff, no opaque artifact in the way.

The one thing LLMs are genuinely bad at is **placing and moving things in 3D space**. Describing
"put the crate two meters left of the door, rotated 30°" in code is slow and error-prone for a
model and a human alike. Dragging it there takes one second.

**That gap is the whole product.** Capsule is the viewport that lets you grab an object and move
it. Everything else stays plain text the LLM owns. The editor is the missing hand, not the brain.

## The principle (this replaces the old "single file" rule)

The thing worth protecting is **readability, not file count.**

A capsule is plain web tech — HTML, CSS, JavaScript, three.js — with **no build step, no
bundler, no transpiler, no compile-then-run cycle.** Edit a file, save, the preview reloads.
Any agent can open the source, change it, and have a working game one second later.

Multiple files are fine. Split when it helps a human or an LLM read the thing; keep it together
when splitting would only scatter attention. The test is always: *can an agent read the whole
game as text and understand it?* If yes, you're good. If you're reaching for webpack, Vite, a
`package.json` of runtime deps, TypeScript, or anything that has to compile before it runs —
**stop.** That breaks the moat.

## What we're building (the editor)

This repo grows the editor around that principle. The pieces:

1. **Viewport + asset placement** — load a capsule, see it rendered, select objects, and
   move / rotate / scale them with gizmos. Changes write back to the capsule's source as plain
   code or a plain data file (e.g. a readable `scene.json`), never an opaque blob. This is the
   core feature — the spatial gap above.
2. **Drag-and-drop asset import** — drop a `.glb` / `.png` / `.hdr` / `.mp3` onto the editor; it
   lands in `assets/` and you get a usable reference. No asset pipeline, no import settings buried
   in binary.
3. **Electron export** — wrap a capsule into native executables for **macOS, Windows, and Linux**.
   The game inside the wrapper stays the same readable files; Electron is only the shell.
   ✅ Implemented in `export/` — run `./export/build.sh [dir|mac|win|linux|all]`. The shell
   serves the capsule from an embedded localhost HTTP server so ES modules + importmap + fetch
   work (they don't over `file://`, and Chromium won't load ES modules over a custom protocol).
   three.js is vendored locally so the export runs fully offline (`--cdn` opts out). npm lives
   only in `export/`; the capsule stays clean.
4. **LLM slot-in (bring your own)** — there is almost nothing to "integrate." The game is already
   LLM-readable text, so the model can be whatever the user wants: a local model, a hosted API
   key, or simply pointing Codex / Claude Code / aider at the folder. Claude Code reads `CLAUDE.md`,
   other agents read `AGENTS.md`. The editor's job is the spatial work the model can't do, not
   generating the code the model already does well.

Keep the editor itself in the same spirit: prefer plain readable web tech over a heavy toolchain.
Electron is the one allowed wrapper, and only for export.

## The capsule format (what the editor reads & writes)

A capsule is a folder. The demo capsule in this repo is the reference shape:

```
./
├── index.html       # entry point — HTML, CSS, and the game's JS
├── assets/
│   ├── models/      # .glb / .gltf
│   ├── textures/    # .png / .jpg / .hdr
│   └── audio/       # .mp3 / .ogg / .wav
├── CLAUDE.md        # agent context (this file)
├── AGENTS.md        # same content, for non-Claude agents
└── README.md        # human-facing readme
```

Reference assets by relative path from the entry point: `./assets/models/player.glb`.
ES modules require an HTTP server — opening via `file://` won't work.

### Code conventions inside a capsule

three.js is imported via the importmap in `<head>`. Pin to whatever version the capsule ships
with; don't bump it unless asked. Addons:

```js
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js';
```

The game's `<script type="module">` is divided into labeled sections. Add new code to the matching
section; if one doesn't exist, add the header too. Canonical order:

```
// === IMPORTS ===
// === RENDERER & SCENE ===
// === CAMERA ===
// === LIGHTS ===
// === WORLD (geometry, materials, environment) ===
// === ENTITIES (player, enemies, pickups) ===
// === INPUT & STATE ===
// === UPDATE (per-frame game logic) ===
// === RENDER LOOP ===
// === RESIZE HANDLER ===
```

Keep mutable game state in plain `const` objects at module scope; avoid classes until the game is
big enough to need them — flat state reads faster for humans and models both. The loop runs on
`renderer.setAnimationLoop(tick)`: read `clock.getDelta()`, update input → physics → entities,
render. Prefer mutating existing entities over recreating them per frame; cache geometries and
materials.

### Asset loading

```js
const loader = new GLTFLoader();
loader.load('./assets/models/player.glb', (gltf) => scene.add(gltf.scene));

const tex = new THREE.TextureLoader().load('./assets/textures/grass.png');
tex.colorSpace = THREE.SRGBColorSpace;  // albedo/color textures only
// leave data textures (normal, roughness, metalness) at default (linear)
```

## How to run a capsule

The editor serves and previews automatically. Standalone:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## What NOT to do

- Don't add a build step to a **capsule** — no webpack/Vite/Rollup, no transpilers, no TypeScript,
  no `package.json` of runtime deps, no `node_modules` shipped inside the game.
- Don't write editor output as an opaque binary. Object transforms, scene layout, anything the
  viewport edits, must land in the source as readable code or a readable data file.
- Don't introduce a game framework (React, Vue, Svelte) inside a capsule.
- Don't fetch from arbitrary CDNs at runtime. The importmap is the only external source.
- Don't reach for a heavy toolchain to build the editor either. Electron is the only allowed
  wrapper, and only for native export.

## Debugging

- `console.log` from a previewed capsule is piped to the editor console.
- Uncaught errors surface in the editor's Errors tab with a "Fix" button that sends the stack
  back to the AI.
- The `#hud` div in the template is a free debug overlay — set `hud.textContent = ...` from
  anywhere to show per-frame info.
