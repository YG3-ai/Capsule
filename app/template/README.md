# A Capsule game

A blank, ready-to-build three.js game. No build step — edit, save, reload.

- **`index.html`** — entry: the scene, the game JS, and the Capsule editor hook.
- **`capsule-edit.js`** — the editor overlay (loaded only in `?edit`). Leave it as-is.
- **`assets/`** — drop `.glb` / textures / audio here.
- **`capsule.scenes.json`** — placement data the editor saves (created on first save).

## Make something

Open this in the Capsule app and use the **AI box** (⌘J): "make a simple 3D fighter game,"
"a 2D top-down shooter," etc. Drag objects in the viewport to fine-tune. Or run standalone:
`python3 -m http.server 8000` → http://localhost:8000/
