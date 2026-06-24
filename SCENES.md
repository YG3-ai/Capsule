# Capsule Scenes & States

How a Capsule game organizes *placement data* — where things sit, across multiple
places and across changes to the same place over time. This is the convention the
Capsule editor reads and writes. **Logic stays in code; placement is data.**

## The three concepts

- **Scene** — a named, loadable place. One is active at a time. (e.g. `pavilion`,
  `foodCourt`, `deadMall`.)
- **State** — a named *variant* of a scene that shares the same geometry and entities
  but changes their placement/visibility. Use it when the same place mutates over time
  — loops, day/night, damage, before/after. A scene that never changes has one state,
  `base`.
- **Placement** — an editable object's transform (`position` / `rotation°` / `scale`)
  and optional `visible`, keyed by a **stable id**.

## Layering (delta on base)

A scene has a `base` — the full set of placements — and each state is a **delta**: only
the objects that differ in that state. The applied result is:

```
applied(id) = base[id]  ⊕  state[id]      // state overrides win, field by field
```

So a base change propagates to every state automatically, state files stay tiny, and a
state only says what's special about it.

## A scene is a data namespace, not an architecture

A scene names a *place*; it does **not** dictate how you organize code. Two valid shapes:

- **One page per scene** (the modular default) — `dead-mall.html` + `dead-mall.js` is its own
  capsule that owns the `deadMall` scene. Scenes are separate files/pages; the editor opens the
  page for the scene you're editing. No in-runtime scene switching.
- **One runtime, many scenes** — a single page streams between places in a session (walking
  through a door). Here one runtime hosts several scenes and uses `setActiveScene`.

Either way, **states stay intra-scene** (a place varying over time) and **placement data stays
per-scene** (`scenes/<scene>.json`). The layout and manifest below cover both.

## File layout

```
capsule/
├── capsule.json              # manifest — scenes → entry page + data + states
├── pavilion.html / .js       # one page per scene (modular default) …
├── dead-mall.html / .js      # … or a single entry hosting many scenes (Pattern B)
├── shared/  assets/          # shared logic + assets (untouched by the editor)
└── scenes/                   # all placement data — readable JSON, one set per scene
    ├── pavilion.json         # base (single-state scene)
    ├── deadMall.json         # base
    ├── deadMall.loop3.json   # state delta — only what changes at loop 3
    └── deadMall.loop6.json
```

`capsule.json` — each scene names its **entry page** and data file, so the editor knows the
full set whether they're separate pages or one runtime:
```json
{
  "scenes": {
    "pavilion": { "entry": "pavilion.html",  "data": "scenes/pavilion.json", "states": ["base"] },
    "deadMall": { "entry": "dead-mall.html", "data": "scenes/deadMall.json", "states": ["loop0","loop3","loop6"] }
  }
}
```

> Small projects may consolidate everything into a single `capsule.scenes.json` with the
> nested shape (`{ scenes: { deadMall: { base: {...}, states: { loop3: {...} } } } }`).
> The editor accepts either; the folder form is for when scenes grow.

## Runtime contract (how a game opts in)

A game exposes its live scene and declares its scenes/states. The editor and the
override-applier both use this. Surface on `window.capsule`:

```js
capsule.defineScene(name, { states, labels, setState })  // setState drives the game to a state
capsule.setActiveScene(name)                              // game calls on level transition
capsule.setActiveState(state)                             // game calls when the loop/variant changes
capsule.registerEditable(obj, id)                         // explicit, immediate registration
capsule.scan()                                            // auto-registers anything tagged (runs on a timer)
```

- On register (explicit or via scan), Capsule applies `base[id] ⊕ activeState[id]`.
- On `setActiveState`, Capsule re-applies the new layer to every registered object.
- The editor *drives* `setState` to jump you to a state to edit it.

### Registering editable assets — the tag convention

**The rule: an object is editable iff it carries a `userData.capsuleId`.** Capsule runs a
periodic `scan()` over the scene graph and registers anything tagged that it isn't already
tracking (and drops anything that has left the scene). So a game opts an asset in *just by
tagging it* — no matter which code path, async loader, or loop rebuild created it:

```js
mesh.userData.capsuleId = 'balcony-watcher';   // tag-only — auto-detected by scan()
// or, for immediate registration + override application at the spawn site:
capsule.registerEditable(group, 'kiosk@-22');  // also sets userData.capsuleId
```

This is why coverage is robust: there's **one** rule (be tagged), not N scattered
registration calls that can be forgotten. If something isn't showing up in the editor, it's
missing a `capsuleId` — tag it at its spawn site.

### Types (categories)

Every editable carries a `type` (`userData.capsuleType`) — `entity`, `prop`, `pickup`,
`plant`, `decal`, `light`, … The editor groups its object list by type, so a 40+ object
scene stays navigable. `capsule.tag(obj, { type, id })` sets both at once and auto-derives a
positional id when you omit it:

```js
capsule.tag(group, { type: 'plant' });              // → id 'plant@<x>,<z>'
capsule.tag(holder, { type: 'pickup', id: 'sunglasses' });
```

### Detectors — auto-tag a whole category

When many objects already share a marker (a `userData` flag, a name prefix, a material),
register **one detector** instead of tagging each. The scan runs it over untagged objects
and tags whatever it matches:

```js
// every found-object pickup becomes editable from its existing marker — zero per-site edits
capsule.addDetector(o => o.userData.isFoundObj
  ? { id: 'pickup-' + o.userData.kind, type: 'pickup' } : null);
```

Detectors are how you make a large existing game editable cheaply: find the patterns its
assets already follow and describe them once.

## Naming spec (locked)

These rules are normative — every game and agent tags assets the same way so the editor,
the data files, and any tooling agree.

### Id rules (`capsuleId`)

- Charset: `[a-z0-9._-]` plus an optional positional suffix. **Lowercase, no spaces.**
- **Stable** across reloads and **unique within a scene** — never reuse an id for two
  objects (the later one overwrites the earlier in the registry).
- Two forms:
  - *Semantic* for one-of-a-kind things: `monster`, `balcony-watcher`, `ft-merchant`,
    `sunglasses`.
  - *Positional* for repeated instances: `<type>@<x>,<z>` (or `@<x>,<y>,<z>` when height
    matters) — `kiosk@-22`, `bench@-12`, `corridor-mannequin@4.6,-12`. The coords keep every
    instance distinct and stable across rebuilds. `capsule.tag(obj, { type })` generates this
    form automatically.

### Standard types (`capsuleType`)

Pick from this vocabulary; add a custom type only when none fits. The editor groups by type.

| type | meaning | examples |
|---|---|---|
| `entity` | characters / actors that move or act | mannequins, monster, NPCs |
| `prop` | static set dressing | kiosks, benches, planters, banners |
| `pickup` | items the player collects or inspects | documents, sunglasses, key |
| `plant` | foliage (distinct from prop for filtering) | potted plants |
| `decal` | flat surface art | posters, signs, stickers |
| `light` | light fixtures / sources | sconces, lamps |
| `trigger` | invisible volumes | exit zones, spawn triggers |
| `marker` | points, not geometry | spawn points, waypoints |

### Reserved words

- **`base`** — a state name only (the shared foundation layer). Don't use it as an id or type.
- **`object`** — the fallback type for an editable with no `capsuleType`. Don't assign it
  explicitly; tag a real type instead.

### Scene & state names

- **Scene** — lowercase identifier matching the level/place: `deadMall`, `foodCourt`,
  `pavilion`.
- **State** — short stable slug (`loop0`…`loop3`); the slug is the file/key, so never rename
  it — change only its human `label` (`'Loop 2 · blackout'`).

## Editor behavior

- **Scene** and **State** pickers (a dropdown + a loop timeline). Picking `deadMall / loop3`
  drives the game to that state and shows it.
- Editing in a **state** saves a **delta** — the editor diffs against base and writes only
  changed objects to that state's file. Editing in `base` writes the base file.
- A base edit is visible in every state that doesn't override that object.

## Best practices the editor encodes

- **Tag to opt in.** An asset is editable iff it has a `userData.capsuleId`; the scan does
  the rest. Coverage is one rule, not N registration calls — so nothing silently slips
  through (the way a manually-registered figure once did).
- **Stable, unique ids.** Ids are the same across reloads and never shared between objects.
  The editor warns on duplicates and on overrides pointing at unknown ids.
- **Data ≠ logic.** Placements live in `scenes/`; behavior stays in code. The editor never
  writes code.
- **States are deltas.** Don't snapshot a whole scene per state — store only what changes,
  so the base stays the single source of truth.
- **One active scene/state.** The game owns the transition; the editor only *requests* one.
