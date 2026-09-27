# ZANZA STUDIO — AGENTS.md

> Rules for AI assistants and human contributors working in this repository.
> Read this file before writing code. It encodes decisions that are expensive to reverse.

---

## 0. WHAT THIS IS

ZANZA STUDIO is a **2D animation production tool** for a recurring adult animated
comedy set in Zanza City, 2097.

It is **not** a drawing app, **not** a generic canvas, **not** a video editor, and
**not** a game engine. It is a structured, document-driven production system whose
entire value proposition is **asset reuse**:

```
CREATE CHARACTER ONCE -> REUSE 100+ TIMES
CREATE SET ONCE       -> REUSE 100+ TIMES
```

The first technical milestone is a real staged, timed, animated scene:
**NIA + KITO + NIA'S APARTMENT + DIALOGUE + EXPRESSIONS + CAMERA + TIMELINE -> EXPORT.**

---

## 1. HARD RULES

### RULE 1 — DO NOT OVERBUILD
Implement only the current phase in `docs/ROADMAP.md`. Never implement a later phase
because it "would be nice". Every unbuilt idea belongs in the roadmap, not in code.

### RULE 2 — REUSABLE ASSETS ARE THE POINT
A character, set, prop, pose, expression, and animation clip are defined **once** in
the project asset library and **referenced by id** from every scene that uses them.
Never duplicate an asset definition into a scene. Never inline Nia into a scene.

### RULE 3 — NIA IS NOT SPECIAL
Nia is the first character, not the only one. The generic system must never contain
`if (character.id === 'nia')`. Adding a character must require **zero** changes to
generic code. This is enforced by review and by the seed-data tests.

### RULE 4 — ASSETS ARE DATA
Characters, sets, props, poses, expressions, audio and episodes are data structures.
Creative content lives in `src/data/`, never in `src/core/` or `src/ui/`.
The renderer and the editor must be content-agnostic.

### RULE 5 — THE CORE IS PURE
Everything in `src/core/` must be free of React, DOM, and browser globals, except
inside explicitly-named modules (`*.browser.ts`). Core modules are plain functions
over plain data. This is what makes the system testable and portable.

### RULE 6 — THE DOCUMENT IS THE SINGLE SOURCE OF TRUTH
All editor mutations go through pure functions in `src/core/document/` that take a
document and return a **new** document. No in-place mutation of the project. No
component-local copies of scene state. React reads derived values via selectors.

### RULE 7 — UNDO IS NOT OPTIONAL
Every user-visible mutation must be undoable. Achieved by snapshot history over
immutable documents (see `docs/ARCHITECTURE.md`). If you add a mutation path that
bypasses `commit()`, it is a bug.

### RULE 8 — TEST BEFORE MOVING ON
After meaningful changes, all four gates must pass:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Do not continue to the next phase with a failing gate. Do not weaken a gate to make
it pass.

### RULE 9 — NO PLACEHOLDERS DISGUISED AS FEATURES
Never claim a feature works if it is mocked. Label status honestly in code and docs:
**implemented** / **prototype** / **placeholder** / **planned**.
A commented-out renderer is a placeholder, not a feature.

### RULE 10 — NO BACKEND YET
No Supabase, no auth, no multiplayer, no server. Persistence is local (IndexedDB).
Design storage behind a repository interface so a cloud backend can be added
later without touching the editor.

### RULE 11 — NO NEW DEPENDENCY WITHOUT A REASON IN THE PR DESCRIPTION
The dependency set is deliberately tiny: React, Zustand, and dev tooling.
Runtime rendering uses the **native Canvas 2D API** — no PixiJS, Konva, or Phaser.
See `docs/ARCHITECTURE.md` §Rendering for why. If you believe a rendering engine is
now required, write the argument down first.

### RULE 12 — SMALL LOGICAL COMMITS
One concern per commit, conventional-commit prefixes
(`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
Never a giant unreviewable commit. Never commit secrets, build output, or `node_modules`.

### RULE 13 — DO NOT INVENT ZANZA LORE
Creative canon (characters, dialogue, world detail) lives in `docs/` and
`src/data/`. Do not invent new recurring characters, new locations, or new plot
beats during engineering work without being asked. Engineering scope and creative
scope are separate.

### RULE 14 — RESPECT PERFORMANCE BUDGET
The dev machine is 16 GB RAM with Intel UHD integrated graphics.
The editor must stay responsive on a 1920x1080 laptop display.
Target: 60 fps stage redraw, no per-frame allocation in the render hot path.

---

## 2. TECH STACK (decided — do not churn)

| Concern | Choice | Note |
|---|---|---|
| Build | Vite 6 | Fast HMR; native ESM |
| Language | TypeScript 5, `strict` | Plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| UI | React 19 | UI shell only — React never touches the render loop |
| Styling | Tailwind CSS 4 | Dark creative workspace, design tokens in CSS variables |
| State | Zustand 5 | One editor store + transient UI store |
| Rendering | Native Canvas 2D | Pure function `renderScene(ctx, doc, scene, time)` |
| Persistence | IndexedDB (hand-rolled, ~120 lines) | No backend |
| Tests | Vitest + Testing Library | Unit on `src/core`, integration on store flows |

**Why not Phaser** (the previous attempt in the sibling `zanza/` repo): Phaser is a
game loop with a scene lifecycle. This product is a document editor with a timeline,
undo/redo, and serialized projects. Porting a game runtime would mean rewriting it
all anyway, while inheriting an engine we would fight on export, determinism, and
testability. That prototype is preserved untouched as a v1 archive; none of its code
is carried forward. Only its *concepts* (a character is a layered rig; poses and
expressions are overridable slots) informed this model.

---

## 3. DIRECTORY RULES

```
src/core/      pure domain: types, geometry, interpolation, document ops,
               serialization, renderer, exporter. NO React, NO DOM.
src/data/      ZANZA creative content (seed project). Data, not logic.
src/state/     Zustand stores, history, autosave, selectors.
src/ui/        React components. Presentation + wiring only.
src/lib/       small framework-agnostic utilities.
```

Imports flow **downward only**: `ui -> state -> core -> (nothing)`.
`core` must never import from `state`, `ui`, or `data`.
A lint rule or review must catch any upward import.

---

## 4. DEFINITION OF DONE (per phase)

- [ ] Feature works in the running app, verified manually at 1440p and 1920p
- [ ] `npm run lint` clean
- [ ] `npm run typecheck` clean
- [ ] `npm run test` green, with new tests for new logic
- [ ] `npm run build` succeeds
- [ ] Mutation is undoable
- [ ] No hardcoded character/set names in generic code
- [ ] Docs updated (`docs/ARCHITECTURE.md` / `DATA_MODEL.md` / `MVP.md`)
- [ ] Commits are small and logical

---

## 5. PHASES

Canonical phase list and status live in `docs/ROADMAP.md`.
Current phase is stated at the top of that file and must be kept accurate.

---

## 6. LEGAL / CREATIVE

ZANZA is an **original** universe. Do not reference, reproduce, or imitate the
characters, artwork, dialogue, branding, or storylines of any existing show,
film, game, or brand. Zanza City is fictional. Do not use real public figures or
real business names. Cultural specificity is a feature; stereotyping is a defect.
