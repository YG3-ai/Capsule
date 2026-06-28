# Dead Mall — a Capsule demo

A moody PSX survival-horror vignette showing what a Capsule game looks like: plain three.js,
no build step, with every character tagged so the editor (and the AI) can grab and place them.

This is also the **reference for modular structure** — `index.html` is a thin orchestrator that
just wires together small `src/` modules:

```
index.html        # wire-up only
src/
  capsule-hook.js # editor/AI runtime
  scene.js        # renderer, scene, camera
  lights.js  world.js  cast.js  loop.js
```

- **`index.html`** — imports the modules and runs them (no game logic piled in)
- **`assets/models/`** — low-poly PSX characters (survivor, doctor, killer, monster)
- Open with `?edit` to drag the cast around; **Save** writes `capsule.scenes.json`

Run it: `python3 -m http.server 8000` then open `http://localhost:8000/demo/`.

Characters are a low-poly PSX character pack (FBX → glTF), retextured with nearest-neighbor
filtering for the crunchy retro look. Swap in your own `.glb` by dropping it on the editor.
