# Capsule game — agent context

This is a **Capsule** game: plain HTML/CSS/JavaScript + three.js, **no build step**. Edit a
file, save, reload. Never add webpack/Vite/TypeScript/a runtime `package.json` — it breaks the
moat.

## Keep the editor working

- **Don't remove the `=== CAPSULE HOOK ===` block** in `index.html` — it's the editor/AI runtime.
- **Make things editable by tagging them**: `window.capsule.registerEditable(obj, id, type)` or
  `capsule.tag(obj, { type })`. Anything with a `userData.capsuleId` is auto-detected. Use stable,
  unique ids — semantic (`player`, `boss`) or positional (`crate@3,-2`). Types: `entity`, `prop`,
  `pickup`, `plant`, `decal`, `light`.
- **Placement is data, logic is code.** Don't hardcode positions you want movable — tag the object
  and let the editor write `capsule.scenes.json`.

## Project layout

```
index.html            entry — HTML, CSS, the game JS, and the editor hook
capsule.json          manifest (scenes + project meta)
capsule.scenes.json   saved object placements (written by the editor)
capsule-edit.js       the editor overlay — don't edit
src/                  game code, split into ES modules as it grows (import from index.html)
scenes/               per-scene / level data you author (spawns, waves, dialogue…)
assets/
  models/             3D models — .glb, .gltf
  textures/           image maps & 2D sprites — .png, .jpg, .hdr, .svg
  audio/              sound & music — .mp3, .ogg, .wav
  animations/         animation clips — .glb, .json
  fonts/              typefaces — .json (three.js), .ttf
```

Keep this shape — it keeps things encapsulated and easy to navigate. Put new files in the folder
that matches their kind; reference them by relative path (`./assets/models/player.glb`).

## Stay modular — no monoliths

This is the most important rule for keeping the game easy to edit (for humans **and** for you):

- **`index.html` is a thin orchestrator.** It imports modules, wires them together, and runs.
  Game logic does **not** live here. The blank starter is one file only because it's tiny — the
  moment it grows past a screenful, split it.
- **One concern per file**, in `src/`. Scene setup, lights, the world, each system (input,
  physics, ai, audio, save…), each entity, the update loop — each gets its own small module.
- **Modules export functions; pass dependencies in.** e.g. `buildWorld(scene)`,
  `loadCast(capsule)`, `startLoop({ renderer, scene, camera })`. Avoid hidden global state.
- **Keep the capsule hook as infrastructure** (its own `src/capsule-hook.js`, or the
  `=== CAPSULE HOOK ===` block) — never tangle game logic into it.
- When a file is doing two things, split it before adding a third. Refactor *toward* small files,
  never *toward* a god-file.

A typical shape as the game grows:

```
index.html                 # wire-up only
src/
  capsule-hook.js          # editor/AI runtime (don't edit)
  scene.js                 # renderer, scene, camera
  lights.js  world.js      # environment
  systems/   input.js  physics.js  ai.js  audio.js
  entities/  player.js  enemy.js
  loop.js                  # per-frame update
scenes/  level-1.json …    # data, not code
```

## Build the game

Replace the starter cube. Add new code as `src/*.js` modules (see above), not piled into
`index.html`. Load assets from the `assets/` folders. three.js is imported via the importmap in
`<head>`. Still **no build step** — these are plain ES modules the browser loads directly.
