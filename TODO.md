# Capsule — TODO

Deferred items, roughly grouped. Not in priority order.

## Editor

- [ ] **Multi-page scene launcher** — reads `capsule.json`, lists scenes, opens each scene's
      `?edit` page. Makes Pattern A (one page per scene) a first-class flow instead of hand-
      navigating URLs. (See GUIDE.md Step 4.)
- [ ] **Full-bright editing toggle** — force every editable visible + lit while editing, so dark
      loops (blackout) and hidden entities (balcony watcher) are actually placeable.
- [ ] **Link Folder on first save** — `editor.html` defaults to Documents on first save; prompt
      to link the project folder instead.
- [ ] **Triage the ⚠ untagged list** — the untagged detector surfaces candidates; the *game*
      still needs each tagged (or a detector written). For theConsumed: ~30 GLBs to triage.

## Runtime / authoring

- [ ] **Extract `capsule-runtime.js`** — the `window.capsule` hook is copy-paste in GUIDE.md.
      Ship it as an importable module so a project is one import, not a pasted block.
- [ ] **Collision follows edits** — moving a prop moves its visual but not its collision
      footprint (bounds are baked at the authored position). Recompute from the live transform.

## theConsumed (the adapted clone)

- [ ] Wire `foodCourt` / `pavilion` scenes editable (currently only `deadMall` is set up).

## Export

- [ ] **Real installers for win / linux** — only `mac` (.dmg) and `dir` are verified; `win`
      (.exe) and `linux` (.AppImage) from a Mac need Wine / Docker.
- [ ] **GLB filename de-dup on import** — two different `tree.glb`s would overwrite in
      `assets/models/`.

## Product / distribution (see the "how is Capsule used" discussion)

- [ ] Decide Capsule's form: copied code → reusable runtime → standalone editor app that
      injects the overlay into any served game. (Open question.)
