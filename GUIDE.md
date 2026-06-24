# Using Capsule

A practical guide to building or adapting a game so Capsule can **track every asset
consistently** — what's editable, where it sits, and how it changes across scenes and
states. For the exact rules (id charset, type vocabulary, file layout), see
[SCENES.md](SCENES.md); this is the how-to.

The one principle behind all of it: **logic stays in code, placement is data.** Capsule
never writes your game's behavior — it gives you (and any LLM) a viewport to position the
things your code creates, and saves those positions as plain, readable JSON.

---

## Two ways to use Capsule

**A. A new single-file capsule** (`index.html` + `scene.js` + `scene.json`).
The editor (`editor.html`) reads/writes `scene.json` directly; you drag primitives and dropped
GLBs, and the game rebuilds from that file. This is the [capsule-starter](index.html) shape —
start here for small/new games. Nothing below about hooks is needed; you just edit `scene.json`
through the editor.

**B. Adapting an existing three.js game** (the powerful path).
Your game keeps its own engine and render loop. You add a small **hook** that exposes the live
scene, **tag** the assets you want editable, and Capsule attaches an editing overlay in `?edit`
mode that saves placements to `capsule.scenes.json`. The rest of this guide is about path B —
it's where consistent asset tracking matters most.

---

## Step 1 — Expose the scene (the hook)

Your game creates a `window.capsule` object once, early, giving Capsule the live three.js
objects and the registry. A minimal version:

```js
import * as THREE from 'three';
const DEG = Math.PI / 180;
function applyTransform(obj, o) {
  if (!o) return;
  if (o.position) obj.position.set(...o.position);
  if (o.rotation) obj.rotation.set(o.rotation[0]*DEG, o.rotation[1]*DEG, o.rotation[2]*DEG);
  if (o.scale)    obj.scale.set(...o.scale);
  if (o.visible !== undefined) obj.visible = o.visible;
}

window.capsule = {
  scene, camera, renderer, THREE,        // your live objects
  data: { version: 1, scenes: {} },      // loaded from capsule.scenes.json
  editable: [], detectors: [], scenes: {},
  activeScene: null, activeState: 'base',

  // base ⊕ active-state delta for the active scene
  _resolve(id) {
    const sc = this.data.scenes?.[this.activeScene]; if (!sc) return null;
    return { ...(sc.base?.[id] || {}), ...(sc.states?.[this.activeState]?.[id] || {}) };
  },
  registerEditable(obj, id, type) {
    obj.userData.capsuleId = id; if (type) obj.userData.capsuleType = type;
    this.editable = this.editable.filter(e => e.id !== id);
    this.editable.push({ id, obj, type: obj.userData.capsuleType || 'object' });
    applyTransform(obj, this._resolve(id)); return obj;
  },
  tag(obj, opts = {}) {
    const o = typeof opts === 'string' ? { type: opts } : opts;
    const id = o.id || `${o.type||'obj'}@${Math.round(obj.position.x*10)/10},${Math.round(obj.position.z*10)/10}`;
    return this.registerEditable(obj, id, o.type);
  },
  addDetector(fn) { this.detectors.push(fn); return this; },
  scan() {
    this.scene.traverse(o => {
      if (this.editable.some(e => e.obj === o)) return;
      let id = o.userData?.capsuleId;
      if (!id) for (const d of this.detectors) { const r = d(o); if (r?.id) { id = r.id; o.userData.capsuleId = id; if (r.type) o.userData.capsuleType = r.type; break; } }
      if (!id) return;
      this.registerEditable(o, id, o.userData.capsuleType);
    });
    this.editable = this.editable.filter(e => { for (let p = e.obj; p; p = p.parent) if (p === this.scene) return true; return false; });
  },
  defineScene(name, def) { this.scenes[name] = def; },
  setActiveScene(name) { if (this.activeScene === name) return; this.activeScene = name; this.editable = []; },
  setActiveState(state) { if (this.activeState === state) return; this.activeState = state; for (const { id, obj } of this.editable) applyTransform(obj, this._resolve(id)); },
};

fetch('./capsule.scenes.json', { cache: 'no-store' })
  .then(r => r.ok ? r.json() : null)
  .then(d => { if (d) window.capsule.data = d; window.capsule.scan(); })
  .catch(() => {});
setInterval(() => window.capsule.scan(), 1500);
```

> This is the same hook used in the adapted `theConsumed` — see its `src/main.js` for the
> worked version with edit-mode bootstrap. A reusable `capsule-runtime.js` can be extracted
> so you don't paste this; ask if you want that.

---

## Step 2 — Make assets editable (registration)

**The rule: an object is editable iff it carries a `userData.capsuleId`.** The `scan()` runs
on a timer and registers anything tagged — so it doesn't matter which function, async loader,
or loop rebuild created the object. There are three ways to tag, in order of preference:

1. **A detector** — when many objects share a marker, describe the pattern once:
   ```js
   capsule.addDetector(o => o.userData.isPickup ? { id: 'pickup-' + o.name, type: 'pickup' } : null);
   ```
   This is how you cover a whole category cheaply. Reach for it first when adapting a big game.

2. **`capsule.tag()` at the spawn site** — for a one-off or a grouped prop:
   ```js
   capsule.tag(group, { type: 'plant' });                 // auto-id → 'plant@<x>,<z>'
   capsule.tag(monster, { type: 'entity', id: 'monster' });
   ```

3. **`registerEditable(obj, id, type)`** — the explicit, immediate form (tag + apply override now).

**Group multi-part props.** If a "thing" is several meshes (a bench = 4 boxes), put them in a
`THREE.Group` at the prop's position with children at local offsets, and tag the group — so it
moves as one unit. (See `theConsumed/src/world/props.js` `editProp`.)

**Coverage is visible.** In `?edit` mode the object panel shows a **⚠ untagged** list of things
that look like assets but aren't tagged. If something isn't editable, it's here — click it to
fly to it, then tag it (or write a detector for its pattern). You're done when the list is empty
of things you care about.

---

## Step 3 — Name and organize (so it's trackable)

Consistent ids and types are what make a project easy to track. Full rules in
[SCENES.md](SCENES.md#naming-spec-locked); the essentials:

- **Ids** are lowercase, stable, and unique within a scene. Two forms:
  - *Semantic* for one-offs: `monster`, `balcony-watcher`, `sunglasses`.
  - *Positional* for repeats: `<type>@x,z` → `kiosk@-22`, `bench@-12`. `tag()` makes these for
    you. Encoding coords keeps each instance distinct and stable across rebuilds.
- **Types** group the editor's list. Use the standard vocabulary:
  `entity · prop · pickup · plant · decal · light · trigger · marker`. Add a custom type only
  when none fits.
- Never reuse an id for two objects (the later overwrites the earlier).

---

## Step 4 — Scenes and state changes

A **scene** is a named *place* in your game (`pavilion`, `deadMall`). It's a placement-data
namespace — **it does not dictate your file or runtime architecture.** Pick whichever fits;
both are first-class.

### Pattern A — one page per scene (the modular default)

Each scene is its **own capsule**: `dead-mall.html` + `dead-mall.js` + `scenes/deadMall.json`.
The page *is* the scene, so you don't call `setActiveScene` and you don't need a `defineScene`
orchestrator — you just set up the hook and tag that page's assets. Navigate between scenes with
links or a small launcher. Nothing monolithic; each scene's code, assets, and data stay
separate. **Prefer this** unless your game genuinely needs Pattern B.

```
my-game/
├── pavilion.html / pavilion.js        # scene: pavilion
├── dead-mall.html / dead-mall.js      # scene: deadMall
├── shared/  assets/
├── scenes/  pavilion.json  deadMall.json  deadMall.loop3.json
└── capsule.json                        # manifest: scene → entry page + data
```

### Pattern B — one runtime, many scenes (continuous worlds)

If your game streams between places in a single session — walking through a door, no reload —
one page hosts several scenes. *Only then* do you `defineScene` each and `setActiveScene` to
switch. (`theConsumed` is built this way; most games aren't.)

```js
capsule.defineScene('deadMall', {
  states: ['loop0', 'loop1', 'loop2', 'loop3'],
  labels: { loop2: 'Loop 2 · blackout' },
  setState: (s) => jumpToLoop(Number(s.replace('loop','')), deadMallLevel),
});
capsule.setActiveScene('deadMall');   // when you transition levels in-runtime
```

### States are variants of one scene (either pattern)

A **state** is the same place changing over time — loops, day/night, damage. Placement data is
**layered**: a `base` shared by all states plus per-state **deltas** that only say what differs.
States live inside one page/runtime via `setActiveState` — they don't imply a monolith.

```js
capsule.setActiveState('loop' + loopCount);   // keep in sync; guard with if (!capsule.editLock)
```

### The manifest ties scenes to pages

A `capsule.json` lists the scenes and where each lives, so the editor knows the full set
regardless of architecture:

```json
{
  "scenes": {
    "pavilion": { "entry": "pavilion.html",  "data": "scenes/pavilion.json" },
    "deadMall": { "entry": "dead-mall.html", "data": "scenes/deadMall.json",
                  "states": ["loop0","loop1","loop2","loop3"] }
  }
}
```

In **Pattern A** you edit each scene by opening *its* page in `?edit` — there's nothing to
switch. In **Pattern B** the editor's **Scene** picker switches scenes in the running app. Either
way the **Layer** picker drives states: editing **Base** affects every state; editing a state
saves only its differences. See [SCENES.md](SCENES.md) for the layering model and file layout.

---

## The editor workflow (`?edit`)

1. Serve the game and open it with `?edit` (Chrome — the save uses the File System Access API).
2. The **object panel** lists everything editable, grouped by type, with a **⚠ untagged**
   section for gaps.
3. Pick a **Scene** and **Layer** (Base, or a specific state/loop). The scene changes to match.
4. Click an object (in the list it flies the camera to it), drag the gizmo (`W`/`E`/`R` = move
   /rotate/scale).
5. **Save** writes `capsule.scenes.json` — full transforms for Base, minimal deltas for a state.
6. Reload without `?edit`: the game applies `base ⊕ state` on load and reflects your edits.

---

## Starting a new project — checklist

- [ ] Expose `window.capsule` early (Step 1).
- [ ] Decide your **types** up front (the standard set usually fits).
- [ ] Tag assets as you create them — `capsule.tag(obj, { type })`. Prefer a **detector** per
      category you already mark in `userData`.
- [ ] Group multi-mesh props so they move as a unit.
- [ ] `defineScene` for each level; call `setActiveScene` / `setActiveState` on transitions.
- [ ] Open `?edit`, clear the **⚠ untagged** list of anything you want movable.
- [ ] Commit `capsule.scenes.json` alongside the game — it's plain readable data.

## Troubleshooting

- **"X isn't editable."** It has no `capsuleId`. Check the **⚠ untagged** list, click it, and
  tag it — or add a detector if many like it exist.
- **"My edits don't show after reload."** The game must read `capsule.scenes.json` and apply
  overrides on load (the `scan()` + `_resolve` in the hook). Confirm the file saved next to the
  game's entry HTML.
- **"Switching state changes nothing."** Either there are no deltas authored for that state yet
  (author some), or `setState` isn't actually driving your game to that variant.
- **"Two objects share a spot / one won't select."** Duplicate ids — the later overwrote the
  earlier. Give each a unique (positional) id.
