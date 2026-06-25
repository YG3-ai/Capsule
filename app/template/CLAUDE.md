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

## Build the game

Replace the starter cube. Put new code in `index.html` (or split into `src/*.js` modules if it
helps readability). Load assets from `assets/`. three.js is imported via the importmap in `<head>`.
