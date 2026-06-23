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

## File layout

```
capsule/
├── capsule.json              # manifest — entry, scenes, each scene's states
├── <entry>.html              # the game
├── src/ …                    # logic (untouched by the editor)
├── assets/ …
└── scenes/                   # all placement data — readable JSON
    ├── pavilion.json         # base (single-state scene)
    ├── foodCourt.json
    ├── deadMall.json         # base
    ├── deadMall.loop3.json   # state delta — only what changes at loop 3
    └── deadMall.loop6.json
```

`capsule.json`:
```json
{
  "entry": "dead_mall.html",
  "scenes": {
    "pavilion":  { "states": ["base"] },
    "foodCourt": { "states": ["base"] },
    "deadMall":  { "states": ["loop0", "loop3", "loop6"] }
  }
}
```

> Small projects may consolidate everything into a single `capsule.scenes.json` with the
> same nested shape (`{ scenes: { deadMall: { base: {...}, states: { loop3: {...} } } } }`).
> The editor accepts either; the folder form is for when scenes grow.

## Runtime contract (how a game opts in)

A game exposes its live scene and declares its scenes/states. The editor and the
override-applier both use this. Minimal surface on `window.capsule`:

```js
capsule.defineScene(name, { states, setState })   // setState drives the game to a state
capsule.setActiveScene(name)                       // game calls on level transition
capsule.setActiveState(state)                      // game calls when the loop/variant changes
capsule.registerEditable(obj, id)                  // at each spawn site; applies base ⊕ state
```

- On `registerEditable`, Capsule applies `base[id] ⊕ activeState[id]` for the active scene.
- On `setActiveState`, Capsule re-applies the new layer to every registered object.
- The editor *drives* `setState` to jump you to a state to edit it.

## Editor behavior

- **Scene** and **State** pickers (a dropdown + a loop timeline). Picking `deadMall / loop3`
  drives the game to that state and shows it.
- Editing in a **state** saves a **delta** — the editor diffs against base and writes only
  changed objects to that state's file. Editing in `base` writes the base file.
- A base edit is visible in every state that doesn't override that object.

## Best practices the editor encodes

- **Stable, unique ids.** Every editable registers with an id that's the same across
  reloads. The editor warns on duplicates and on overrides pointing at unknown ids.
- **Data ≠ logic.** Placements live in `scenes/`; behavior stays in code. The editor never
  writes code.
- **States are deltas.** Don't snapshot a whole scene per state — store only what changes,
  so the base stays the single source of truth.
- **One active scene/state.** The game owns the transition; the editor only *requests* one.
