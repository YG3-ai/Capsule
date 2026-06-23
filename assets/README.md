# Assets

Drop files here and reference them from `index.html` as `./assets/<subdir>/<file>`.

- `models/` — `.glb` (preferred) or `.gltf`. Load with `GLTFLoader`.
- `textures/` — `.png`, `.jpg` for color/data maps; `.hdr` / `.exr` for environment maps.
- `audio/` — `.mp3`, `.ogg`, `.wav`. Load via `THREE.Audio` + `AudioLoader`, or just plain `<audio>` for simple cases.

Keep filenames lowercase, no spaces. Prefer `player_walk.glb` over `Player Walk.glb`.
