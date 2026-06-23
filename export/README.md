# Capsule → native executable

Wraps a capsule (a folder of plain HTML/JS/assets) into a native desktop app for
macOS, Windows, and Linux. This is the **one place Capsule uses npm** — Electron and
electron-builder live here only, as the export shell. The game itself never gets a
`package.json` and stays dependency-free.

## Usage

```bash
./export/build.sh [target] [--capsule DIR]
```

| arg | default | meaning |
|-----|---------|---------|
| `target` | `dir` | `dir` (fast unpacked app) · `mac` · `win` · `linux` · `all` |
| `--capsule DIR` | the capsule `export/` lives in | wrap a different capsule |

Examples:

```bash
./export/build.sh                          # wrap this capsule, unpacked, for this OS
./export/build.sh mac                       # macOS .dmg
./export/build.sh all                       # .dmg + .exe + .AppImage
./export/build.sh mac --capsule ~/games/x   # wrap another capsule
```

Output lands in `export/dist/`. The script refuses to run if the target folder has
no `index.html`, and validates that **before** copying anything.

## How it works

`build.sh` stages the game files into `export/.build/`, drops in the Electron shell
(`main.js` + `package.json`), runs electron-builder, and copies the result to
`export/dist/`. The capsule is never modified, and the editor (`editor.html`),
docs, and this tooling are excluded from the build.

`main.js` serves the game from a tiny **localhost HTTP server** (Node's built-in `http`,
bound to `127.0.0.1`, no dependencies) and points the window at `http://127.0.0.1:<port>/`.
That matters because capsules use ES modules + an importmap + `fetch()`: the browser blocks
all of those on `file://`, and Chromium refuses to load ES module scripts over Electron
custom protocols (`fetch` works but `import` fails). A real localhost origin behaves exactly
like the dev server, so the game runs unchanged.

## Naming & icons

Edit `productName` / `appId` in `export/package.json` to rename the app. To set a
custom icon, add `mac.icon` / `win.icon` / `linux.icon` pointing at `.icns` / `.ico`
/ `.png` files; without them, electron-builder uses the default Electron icon.

## Offline by default

The build **vendors three.js locally** so the exported app needs no internet at runtime.
It reads the three version pinned in the capsule's importmap, runs `npm pack three@<that
version>`, copies `build/three.module.js` + the whole `examples/jsm/` (addons) tree into
`vendor/three/` in the staged copy, and rewrites the importmap to point there. The source
capsule is never modified — it keeps its CDN importmap for editor/dev use.

Pass `--cdn` to skip vendoring and keep loading three from the CDN (smaller build, but the
app then needs internet):

```bash
./export/build.sh mac --cdn
```
