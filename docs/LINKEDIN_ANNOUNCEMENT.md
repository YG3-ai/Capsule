# Capsule — LinkedIn announcement kit

Everything you need to post the launch: which images to use, ready-to-paste copy, and posting tips.
All images live in [`docs/media/`](media/).

> **Attribution:** the `04-mosaic.png` and `07-ai-box.png` frames use concept art from **Iron Abyss**
> (© OTR HVN) as the example moodboard. If you post publicly, credit it (e.g. *"moodboard art: Iron Abyss."*).

---

## TL;DR — what to post

**Format:** a **document carousel** (5 slides) is the single highest-engagement format on LinkedIn
right now — people swipe, which the algorithm rewards. If you'd rather keep it simple, post the
**GIF first** (it autoplays in-feed and stops the scroll) with the copy below.

**The hook that does the work (first line — this is 90% of it):**
> An AI can write an entire 3D game — the shaders, the game loop, all of it.
> It cannot move a crate two meters to the left.

---

## Option A — Carousel (recommended)

Build a 5-slide carousel (export as PDF, or post as multiple images). Suggested order:

| Slide | Image | On-slide text |
|-------|-------|---------------|
| 1 — Hook | `docs/media/01-welcome.png` | **"AI can build the game. It can't place the crate."** Capsule — build a game, drag it into place. |
| 2 — The gap | `docs/media/06-gizmo.png` | Describing *"2m left, rotated 30°"* in code is slow and wrong. Dragging it takes a second. **That gap is the whole product.** |
| 3 — Point at it | `docs/media/03-pins.png` | Drop pins on the scene and say **"look."** The AI sees exactly what you're pointing at. |
| 4 — AI works with you | `docs/media/07-ai-box.png` | It reads your pins, moves the wall, saves it — all in plain, readable files. |
| 5 — Brief it with pictures | `docs/media/04-mosaic.png` | Mosaic: drop concept art on a board, hit *"Reference in chat."* Models design better from images. |

> Keep slide text to one idea each. Big type, lots of dark space — the screenshots are the star.

---

## Option B — Single post (fastest)

**Lead image:** `docs/media/drag.gif` *(motion autoplays and stops the scroll)*
— or `docs/media/07-ai-box.png` if you want the full story in one frame.

**Body copy (paste-ready):**

```
An AI can write an entire 3D game — the shaders, the game loop, all of it.

It cannot move a crate two meters to the left.

That one gap — putting things exactly where they go in 3D space — is the
whole reason we built Capsule.

It's a thin visual editor for three.js games that stay plain, readable text.
No build step. No bundler. Nothing to compile. The AI writes the code; you
grab objects and drag them into place.

The part I'm most excited about 👇

You can drop numbered pins right onto the scene and say "look."
The AI sees a screenshot of your exact view AND the real coordinates of every
pin — so "extend the upper floor between these two markers" just... works.

It's the difference between describing a spot in a paragraph and pointing at it.

A few more things it does:
• Drag / rotate / scale anything the AI placed — with a real gizmo
• Mosaic: a moodboard to brief the AI with reference images, not just text
• Bring your own model — Claude Code, Codex, aider, or local
• Export to Mac / Windows / Linux (and mobile)

Every edit is saved as plain, readable data. Nothing opaque. An agent can open
the whole game as text and have it running one second later.

Free & open source.

What would you build first? 👇
```

---

## Alternate hooks (A/B test the first line)

- *"We spent a decade making game engines heavier. We went the other way."*
- *"The best game editor is the one that gets out of the AI's way."*
- *"Your AI can't point. So we gave it eyes."* (pairs with the pins/`look` shot)
- *"three.js game, no build step, no bundler — and an AI that can see the scene."*

---

## Engagement tips

- **Post the hook, then a line break, then the payoff.** LinkedIn cuts off after ~2 lines with
  "…see more" — earn the click.
- **A GIF or carousel beats a static image.** `drag.gif` autoplays; carousels get swipes.
- **End on a question** (*"What would you build first?"*) and **reply to every comment in the first
  hour** — early comments drive reach.
- **Lead the pins/`look` feature** — it's the most novel thing here and the most screenshot-worthy.
  `03-pins.png` and `07-ai-box.png` are your strongest single frames.
- Drop 3–5 hashtags at the end, not mid-post.

**Suggested tags:** `#gamedev #threejs #indiedev #AItools #creativecoding #webgl #yg3`

---

## Asset index (`docs/media/`)

| File | What it shows | Best for |
|------|---------------|----------|
| `01-welcome.png` | Welcome screen + tagline | Carousel slide 1 / brand |
| `drag.gif` | Move gizmo dragging an object | **Single-post lead (motion)** |
| `06-gizmo.png` | Gizmo + live inspector | "the gap" / editor detail |
| `03-pins.png` | Numbered reference pins on the scene | **The hero feature** |
| `07-ai-box.png` | Editor + docked AI box running `look` → `move` | **Full-story single frame** |
| `04-mosaic.png` | Mosaic moodboard of concept art (Iron Abyss art) | Mosaic / design-first |
| `05-new-project.png` | 2D/3D · PC/Mobile chooser | "getting started" |
