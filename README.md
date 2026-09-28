# ZANZA STUDIO

A 2D animation production tool for a recurring adult animated comedy set in Zanza
City, 2097.

It is **not** a drawing app, **not** a generic canvas, **not** a video editor, and
**not** a game engine. It is a structured, document-driven production system, and
its entire reason to exist is asset reuse:

```
CREATE CHARACTER ONCE -> REUSE 100+ TIMES
CREATE SET ONCE       -> REUSE 100+ TIMES
```

A character, set, prop, pose, expression, and audio cue are defined once in the
project asset library and referenced by id from every scene that uses them. Nothing
about a character is ever copied into a scene.

---

## STATUS — read this first

This is an **honest** status. Nothing below is aspirational, and nothing is claimed
that is not implemented and tested. The full phase table is in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

| | |
|---|---|
| Build gates | `lint`, `typecheck`, `test`, `build` all green |
| Tests | 76 passing, no browser required |
| Works | Document model, renderer, seed content, persistence, read-only stage, transport |
| Present but unreachable | Undo/redo and autosave. `commit()` exists and is enforced, but **no editing control calls it yet**, so there is nothing to undo |
| Missing | Timeline UI, all editing controls, audio playback, episode playback, **export** |

Concretely: the engine works and the content exists, but **there is no timeline and
there is no export.** The application is a shell around a working core, not a
finished editor. Do not judge this repository by its screenshots; judge it by the
gates.

Using it, including the defects you will hit: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md).
Hosting a built copy: [`docs/DEPLOY.md`](docs/DEPLOY.md).

**The MVP acceptance gate is not met.** See
[`docs/MVP.md`](docs/MVP.md) §4 for which of the ten checks are blocked on what.

---

## QUICKSTART

Requires Node 20 or newer (developed and verified on 22).

```bash
npm install
npm run dev          # http://localhost:5173
```

On first run there is no database, so the app renders the EP001 demo project from an
in-memory seed. That seed is **not written to IndexedDB**, and is regenerated on
every load. Saving writes whatever is in the editor to IndexedDB under the origin you
loaded the app from.

### The four gates

```bash
npm run lint         # eslint
npm run typecheck    # tsc -b, no emit
npm run test         # vitest, single run
npm run build        # tsc -b && vite build
```

Or all four in sequence:

```bash
npm run verify
```

**All four must pass before work moves to the next phase.** This is
[`AGENTS.md`](AGENTS.md) RULE 8. No gate gets weakened to let something through.

---

## WHAT THE FIRST MILESTONE PROVES

The technical milestone is one real staged, timed, animated scene:

```
NIA + KITO + NIA'S APARTMENT + DIALOGUE + EXPRESSIONS + CAMERA + TIMELINE -> EXPORT
```

`src/data/seed.ts` builds that project. It is constructed through the same public
document operations the editor uses, so the seed cannot drift from the invariants
the app enforces.

EP001, *Rent Is Due*, is five scenes:

| # | Scene | Beat |
|---|---|---|
| 1 | Nia's Apartment | The rent conversation. Nia and Kito, four lines, a walk-in, a camera push-in. |
| 2 | Nia's Apartment | The landlord arrives. |
| 3 | Zanza Street | Outside. |
| 4 | Zanza Lounge | The empire conversation. |
| 5 | Nia's Apartment | Mama Nia calls. |

The acceptance dialogue in scene 1:

> **NIA** — "Bro, where have you been?"
> **KITO** — "Building my empire."
> **NIA** — "You owe me rent."
> **KITO** — "...the empire is still in development."

### The one test that matters most

[`src/data/rule3.test.ts`](src/data/rule3.test.ts) exists because
[`AGENTS.md`](AGENTS.md) RULE 3 says Nia is not special, and because that rule is
easy to state and easy to quietly break.

It defines a character that appears nowhere in `src/data`, adds it to the
production project, stages it, keyframes it, poses it, gives it an expression, and
renders it — touching no file in `src/core`. The project validates cleanly
throughout.

If that test ever needs a code change to pass, the architecture has failed,
regardless of whether anything else works.

---

## ARCHITECTURE

Full detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

```
ui  ->  state  ->  core
```

Imports flow **downward only**. `src/core` never imports from `state`, `ui`, or
`data`. If it does, the layering is broken.

| Directory | Contents | May depend on |
|---|---|---|
| `src/core/` | Types, geometry, interpolation, document operations, invariants, serialization, renderer. **No React, no DOM.** The exporter belongs here and does not exist yet. | nothing |
| `src/data/` | The ZANZA creative content. Data, not logic. | `core` |
| `src/state/` | Zustand store, snapshot history, autosave. There are no selector helpers yet. | `core`, `data` |
| `src/ui/` | React components. Presentation and wiring only. | `state` |
| `src/test/` | Test helpers, including the recording canvas. | `core` |

There is no `src/lib/`. If a utility belongs to the domain it goes in `core`; if it
belongs to the browser it goes in an explicitly named `*.browser.ts`; if it belongs to
a component it stays in `src/ui/`. Do not create `src/lib/` to escape those rules.

Four rules carry most of the weight:

**1. The core is pure.** Everything in `src/core` is plain functions over plain
data, free of React, DOM, and browser globals — except inside explicitly named
`*.browser.ts` modules. `indexedDb.browser.ts` is the only one. This is what makes
the system testable: `renderScene` is a pure function, so a test can assert exactly
what would have been painted without a browser, a GPU, or a single pixel
comparison.

**2. The document is the single source of truth.** Every editor mutation goes
through a pure function in `src/core/document/` that takes a document and returns a
new one. No in-place mutation, no component-local copies of scene state.

**3. Undo is not optional.** It works by snapshotting immutable documents, and every
user-visible mutation routes through a single `commit()` in the store. A mutation
path that bypasses `commit()` is a bug, not a shortcut. The mechanism is built and
enforced, but it is **currently unreachable from the UI** because no editing control
exists yet — so undo/redo are honest dead buttons today, not broken ones.

**4. Assets are data.** Characters, sets, props, poses, expressions, and audio are
data structures. Creative content lives in `src/data/`, never in `src/core/` or
`src/ui/`. The renderer and the editor are content-agnostic.

### Rendering

`renderScene(ctx, project, scene, time)` — pure, deterministic, stateless — drawing
through the **native Canvas 2D API**. It allocates a small number of short-lived
objects per frame (sampled transforms, the draw list); it is not yet allocation-free,
which is a Phase 13 optimisation, not a claim made here.

There is no PixiJS, Konva, or Phaser. The sibling `zanza/` repository is a preserved
Phaser prototype kept untouched as a v1 archive; none of its code is carried forward.

### Stack

| Concern | Choice |
|---|---|
| Build | Vite 6 |
| Language | TypeScript 5, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| UI | React 19 — shell only, never in the render loop |
| Styling | Tailwind CSS 4 |
| State | Zustand 5 |
| Rendering | Native Canvas 2D |
| Persistence | IndexedDB, hand-rolled, behind a `ProjectRepository` interface |
| Tests | Vitest + Testing Library |

The dependency set is deliberately tiny. Adding one requires the argument to be
written down first — [`AGENTS.md`](AGENTS.md) RULE 11.

**Why not Phaser?** The previous attempt in `zanza/` was a Phaser project. Phaser
is a game loop with a scene lifecycle. This product is a document editor with a
timeline, undo/redo, and serialized projects. Porting a game runtime would mean
rewriting all of it while inheriting an engine we would then fight on export,
determinism, and testability. Only its *concepts* — a character is a layered rig,
poses and expressions are overridable slots — informed the current model.

---

## TESTING

```bash
npm run test              # single run
npm run test:watch        # watch mode
```

No browser, no canvas, no snapshots of pixels.

`renderScene` is a pure function, so `src/test/recordingContext.ts` provides a
`Canvas2DLike` that records every call. A test can then assert what would have been
painted and why. When a rendering bug is found, the regression test asserts on a
number or a call sequence, not on an image.

| File | Covers |
|---|---|
| `src/core/animation/sample.test.ts` | Keyframe sampling, per-channel holds, camera resolution, geometry |
| `src/core/animation/sparse.test.ts` | Channels that are absent at one end of a segment, and channels first keyed mid-track |
| `src/core/render/parts.test.ts` | Draw-list geometry, the `-pivot * size` contract, hidden parts and their children |
| `src/data/seed.test.ts` | Seed validity, serialization round trip, asset integrity, all five scenes |
| `src/data/render.test.ts` | Recorded render output and timeline integration |
| `src/data/rig.test.ts` | Rig hierarchy: children resolved before paint order, pivots, cycles |
| `src/data/ops.test.ts` | Document operation regressions |
| `src/data/rule3.test.ts` | **RULE 3** — a new character needs no `core` changes |

---

## DOCUMENTATION

| File | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | **Read before writing code.** 14 hard rules encoding decisions that are expensive to reverse. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phase list, current phase, and honest per-phase status. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The system design and the reasoning behind it. |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Every document and asset type, field by field. |
| [`docs/MVP.md`](docs/MVP.md) | Required capabilities, scope boundaries, the ten-point acceptance gate. |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | The product, the user, and what it is for. |
| [`docs/PLAN.md`](docs/PLAN.md) | What gets built next, in what order, and what is deliberately not being built. |
| [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) | **How to use the app today**, including the defects you will hit. |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | **Building and hosting a deployed copy**, and the storage consequences of no backend. |

---

## WORKING ON THIS

Read [`AGENTS.md`](AGENTS.md) first. It is short and it is not advisory.

The rules that most often catch people:

- **Do not overbuild.** Implement the current phase in `docs/ROADMAP.md` and nothing
  else. Every unbuilt idea belongs in the roadmap, not in the code.
- **Do not invent Zanza lore.** Creative canon lives in `docs/` and `src/data/`.
  Engineering scope and creative scope are separate, and new characters, locations,
  and plot beats are not engineering decisions.
- **No placeholders disguised as features.** Label status honestly: implemented,
  prototype, placeholder, planned. A commented-out renderer is a placeholder, not a
  feature.
- **Small logical commits.** One concern per commit, conventional-commit prefixes,
  never a giant unreviewable commit.

---

## LEGAL

ZANZA is an **original** universe. Zanza City is fictional. Do not reference,
reproduce, or imitate the characters, artwork, dialogue, branding, or storylines of
any existing show, film, game, or brand.
