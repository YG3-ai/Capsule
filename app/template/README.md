# A Capsule game

A blank, ready-to-build three.js game. No build step — edit, save, reload.

```
index.html            entry: the scene, the game JS, and the editor hook
capsule.json          manifest · capsule.scenes.json  placements (editor-written)
capsule-edit.js       editor overlay (loaded only in ?edit) — leave as-is
src/                  game code modules            scenes/  per-scene / level data
assets/  models/ · textures/ · audio/ · animations/ · fonts/
```

## Make something

Open this in the Capsule app and use the **AI box** (⌘J): "make a simple 3D fighter game,"
"a 2D top-down shooter," etc. Drag objects in the viewport to fine-tune. Or run standalone:
`python3 -m http.server 8000` → http://localhost:8000/
