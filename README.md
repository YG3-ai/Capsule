# Capsule

A thin visual editor for three.js games that stay **plain, readable text** ->HTML, CSS,
JavaScript, with no build step, no bundler, nothing to compile. Easy to use and painless to augment with your own tools.

Capsule is free and open source for all game devs!

Please consider donating if Capsule is useful to you.

[Support via Stripe](https://buy.stripe.com/5kQfZh5V30oabyO6ncb7y0i)


## Why

AI is a great pair programmer. What it can't do well is **place things in
3D space and design levels** — "move the crate two meters left and rotate it 30°" is painful in code and trivial
with a mouse. Capsule is the viewport that closes that gap. You drag objects where they go and easily slot in AI assistants to help with backend tasks and code. We purposefully have avoided the bloat typical game editors introduce.

Readability is the whole point. No webpack, no Vite, no transpile step, no opaque artifact — so
any model can open the source and have a working game one second later.

## Docs

- **[GUIDE.md](GUIDE.md)** — using Capsule: the hook, tagging assets, naming, scenes & state
  changes, and the editor workflow. Read this to start a project.
- **[SCENES.md](SCENES.md)** — the spec for scenes/states, the tag/type/detector conventions,
  and the naming rules.

## What it does (roadmap)

- **Viewport placement** — select, move, rotate, and scale objects; changes save back to plain
  source or a readable data file.
- **Drag-and-drop assets** — drop a `.glb`, texture, or audio file straight into the project.
- **Native export** ✅ — wrap a game into an executable for **macOS, Windows, and Linux** via
  Electron: `./export/build.sh [dir|mac|win|linux|all]`.
- **Bring your own AI** — point a local model, an API key, or Codex / Claude Code / aider at the
  folder. The files are already readable; there's nothing to integrate.

## Run a game locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

(The editor serves and previews automatically. ES modules need an HTTP server — `file://` won't work.)

## Work on a game with an AI

- **Claude Code:** run `claude` in the game's directory. It reads `CLAUDE.md`.
- **Codex CLI / aider / opencode / etc.:** they read `AGENTS.md` (same content).
- **In the editor:** use the built-in AI panel.

## A capsule (the game format)

```
index.html    # entry point — HTML, CSS, and the game's JS
assets/       # models (.glb), textures (.png/.hdr), audio (.mp3) — drop them in
CLAUDE.md     # AI context for Claude Code
AGENTS.md     # same content, for other agents
```

Multiple files are fine — split when it helps readability and modularity.

## Controls (demo scene)

- **W A S D** / arrow keys — move the capsule
- **Mouse drag** — orbit camera
- **Scroll** — zoom

That's the starting point. Make something good.
