# Capsule game — agent context

This is a **Capsule** game: plain HTML/CSS/JavaScript + three.js, **no build step**. Edit a
file, save, reload. Never add webpack/Vite/TypeScript/a runtime `package.json` — it breaks the
moat.

## Keep the editor working

- **Don't remove the `=== CAPSULE HOOK ===` block** in `index.html` — it's the editor/AI runtime.

- **Add assets with `capsule.add(obj, opts)` — this is the standard.** It parents the object,
  tags it editable, and wires its *attributes* so they move with it when an editor drags it:

  ```js
  window.capsule.add(crate, {
    type: 'prop',                    // entity | prop | pickup | plant | decal | light | trigger | marker
    id:   'crate@3,-2',              // stable + unique; omit to auto-derive from position
    collide:  { w: 0.5, d: 0.5 },    // following AABB — query window.capsule.blocked(x, z) in your movement code
    light:    { color: 0xffaa55, intensity: 2, distance: 8 },   // child light, follows the asset
    sound:    { src: './assets/audio/buzz.mp3', radius: 6 },    // spatial PositionalAudio child, follows
    behavior: (o, dt) => { o.rotation.y += dt; },               // per-frame; runs via capsule.tick(dt)
  });
  ```

  An asset is **one object (usually a `Group`) that bundles its own attributes.** Children
  (light, sound) follow transforms for free because they live in the scene graph; `collide` is
  tied to the object so its footprint tracks the live position. Add your own attribute kinds with
  `window.capsule.component('name', (obj, spec) => { … })`.

- **Lower-level tagging still works** for objects you place by hand: `capsule.registerEditable(obj,
  id, type)` or `capsule.tag(obj, { type })`. Anything with a `userData.capsuleId` is auto-detected.
  Prefer `capsule.add` for anything new — it's the same tag plus the attribute system.

- **Placement is data, logic is code.** Don't hardcode positions you want movable — add/tag the
  object and let the editor write `capsule.scenes.json`.

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
