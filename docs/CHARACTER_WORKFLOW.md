# ZANZA STUDIO — CHARACTER WORKFLOW

> How a character goes from a person's real face to a reusable, animation-ready asset.
>
> **Status of this document: process, not product.** It describes a manual, human-in-the-loop
> pipeline for producing character art today, using free tools and an existing reference set.
> Nothing here is a feature of the application. No code reads the folders it describes. It is
> written down so the same inputs produce the same outputs twice, and so the honest state of
> each artifact is recorded rather than assumed (AGENTS.md RULE 9).
>
> **This document does not invent ZANZA lore.** It says nothing about who Nia is, what she
> wears, or what she does. Creative canon lives in `docs/` and `src/data/` and is decided by
> the author, not by a pipeline (AGENTS.md RULE 13).

---

## 0. WHY THIS EXISTS

ZANZA's value is asset reuse: a character is created once and referenced by id from every
scene. The bottleneck is not the engine — it is turning a real, specific person's face into a
consistent design that can be drawn, posed and reused a hundred times.

The engine today can only display **vector** characters. A painted PNG cannot appear on the
Stage, in a preview, or in an export. So there are two distinct products to keep separate:

| Target | What it is | Renders today? |
|---|---|---|
| **Vector rig** | A `CharacterDef` (palette + `PartDef[]`) in `src/data/` | Yes — Stage, preview, PNG export |
| **Painted layered art** | Cut-out PNG parts fed to a future `ImageResolver` | No — planned, [Phase 20+ art pipeline](ROADMAP.md) |

**The vector rig comes first.** It is the only thing that works in the running app now. Painted
art is prepared alongside it as source material for the future image pipeline; it is
**placeholder** until that pipeline exists.

---

## 1. HARD RULES FOR THIS WORKFLOW

1. **Consent and privacy.** Only use images of a real person with their consent. Never upload
   a private photo to a service automatically. Strip EXIF before anything leaves the machine.
   Check a service's data-use and public-gallery settings before use. Prefer offline tools.
2. **No invented assets.** Do not generate visual designs that claim to be canon before the
   author approves them. Every artifact is a *proposal* until it is moved into `approved/`.
3. **No unverified claims.** Label every artifact by lifecycle stage (see §3). Do not call a
   proposal "the design".
4. **No new dependencies or code.** This workflow adds files under `assets/` and this document.
   It does not add npm packages, renderer changes, or API calls.
5. **One change at a time.** Merge the face first, then hair, then wardrobe. A single combined
   change cannot be reviewed or reverted.

---

## 2. INPUTS

Everything lives under `assets/characters/<character-id>/`. For Nia that is
`assets/characters/nia/`.

### 2.1 Required for an identity merge

| Input | Folder | Minimum |
|---|---|---|
| **Identity source** — the dated, approved design this character must stay consistent with | `references/` | one clean sheet |
| **Current appearance** — the specific face/hairstyle to fold in | `references/` | **front, 3/4 and side**, neutral expression, even lighting, plain background |

A single current-appearance photo is **not** enough. One view cannot define a face in the
round; the merge will drift the moment a different angle is drawn. Front + 3/4 + side is the
floor, not a target.

### 2.2 Nia's current references

| File | Role |
|---|---|
| `references/original_nia_design_bible.png` | Identity source (the approved design to preserve) |
| `references/current_appearance_reference.png` | Current appearance — **one undated view only**; insufficient on its own |
| `references/nia_merged_identity_concept_sheet.png` | A merged-identity proposal (not yet approved) |

### 2.3 Input hygiene

- Shoot or export at the largest resolution available; downscaling loses detail that the
  merge needs.
- Neutral expression, mouth closed, eyes open. An expressive photo bakes that expression into
  the design.
- Even, diffuse light. Hard shadows read as a facial feature and get copied into the design.
- Strip EXIF (`metadata`) before the file enters the repo. This repository's references carry
  no camera metadata — keep it that way.
- One subject per image. No group photos as identity sources.

---

## 3. ARTIFACT LIFECYCLE

Every file's folder states its status. A file's location *is* its label.

| Folder | Status | Meaning |
|---|---|---|
| `references/` | **input** | Raw source material. Not a design. Never rendered. |
| `prompts/` | **process** | The exact prompt + settings used to produce a proposal, so it is reproducible. |
| `approved/` | **approved** | The current canonical design. Exactly one set is authoritative. |
| `expressions/` | **approved (facial)** | Approved expression variants, cut or authored from the approved face. |
| `parts/` | **approved (body)** | Approved layered body parts for the painted pipeline. |
| `environments/` | **approved (set)** | Approved environment art (see the set workflow, not this one). |

A proposal that is not yet approved lives in `references/` until the author moves it. This
keeps "what the author has decided" separate from "what a tool produced".

---

## 4. THE PIPELINE

Progressive, with an approval gate after each step. Stop at any gate. Nothing downstream runs
until the gate is passed, because a rejected face makes every later step wasted work.

```
1. Assemble inputs        -> front / 3-4 / side of current appearance + identity source
2. Neutralize             -> one consistent, evenly-lit, plain-background set
3. Extract landmarks      -> proportion notes (not pixels): eyes, nose, mouth, jaw, hairline
4. Merge proposal         -> fold landmarks into the identity design; produce ONE sheet
   [GATE A: author approves the merged identity]
5. Variant sheet          -> 3-5 candidate faces that all satisfy the same landmarks
   [GATE B: author picks one]
6. Expression set         -> neutral, happy, angry, sad, surprised, skeptical
7. Turnaround             -> front / 3-4 / side / back of the APPROVED design
8. Character sheet        -> palette, proportions, hair, wardrobe silhouette, notes
   [GATE C: character sheet frozen]
9. Vector authoring       -> encode the frozen sheet as a CharacterDef in src/data/
   [GATE D: renders on Stage, poses + expressions resolve]
10. Painted-pipeline prep -> cut approved art into parts for the future ImageResolver (placeholder)
```

**Gates A–C are human decisions.** No tool decides them. Gate D is the four project gates
(`lint`, `typecheck`, `test`, `build`) plus a manual look at 1440p.

### 4.1 Step notes

- **Step 3 — landmarks, not pixels.** Write proportions as ratios of head height (eye line,
  nose base, mouth line, jaw width). Ratios survive scaling; pixel coordinates do not.
- **Step 4 — merge, do not replace.** The identity source defines who the character is; the
  current appearance defines specific features. The merged sheet is the identity source with
  those features folded in, not a redraw of the photo.
- **Step 5 — variants.** Produce variants that all satisfy the landmarks. This exposes which
  differences are in the source and which are the tool's noise.
- **Step 9 — vector authoring.** The frozen sheet becomes a `CharacterDef`: a palette plus a
  rig. The shared template (`buildHumanRig` in `src/data/rig.ts`) covers a character whose
  silhouette the template can express; one it cannot gets its own rig module beside it. See §6.

---

## 5. TOOL GUIDANCE (free / offline first)

Assessed 2026-10-22. Free-tier terms change without notice — re-check before relying on them.

| Need | Preferred | Notes |
|---|---|---|
| Photo import, crop, level, EXIF strip | GIMP / Krita / Pillow | Offline, unlimited, private. Do this before anything else. |
| Landmark measurement | manual, with a grid overlay | No network, no account. |
| Reference-guided merge / edit | Gemini app (free) | Best verified free browser option. Upload only consenting-person images. |
| Vector authoring | the editor itself / Inkscape | The rig is data; hand-editing `src/data/` is first-class. |
| Cut-out for painted parts | GIMP / Krita | Offline. |

**Do not assume:** no meter-free image-generation API was verified; free tier limits are
unpublished and change. **Do not attempt local diffusion** on the reference machine (16 GB RAM,
Intel UHD integrated graphics) — it is below the practical floor for SDXL/FLUX class models.

**Privacy captions:** before a photo leaves the machine, confirm it is the consenting subject,
strip EXIF, and switch off any "publish to gallery" or "improve the model" setting.

---

## 6. FROM FROZEN SHEET TO VECTOR RIG

The frozen character sheet (Gate C) maps onto a `CharacterDef` like this:

| Sheet element | `CharacterDef` field |
|---|---|
| Colours | `palette` (skin, skinShade, hair, brow, eye, mouth, top, bottom, shoe, accent) |
| Proportions | the rig: `buildHumanRig(proportions(height, build))` in `src/data/rig.ts`, or a character-specific rig module |
| Hair style | the `hairStyle` option (`afro` \| `locs` \| `long` \| `short` \| `bald` \| `bun`) |
| Height | `height` (px at scale 1, feet at y = 0) |
| Defaults | `defaultPoseId`, `defaultExpressionId` |

**Generic code is not touched.** Adding a character is adding a `CharacterDef` to
`src/data/characters.ts`. If a step seems to require an `if (character.id === ...)` anywhere,
the design does not fit the rig and the rig is the thing to reconsider — not the guard
(AGENTS.md RULE 3).

**A character may ship its own rig module.** The shared template is a default, not a
schema. When a frozen sheet's silhouette or wardrobe the template cannot express — layered
locs, a cropped top over a midriff, a belt with a buckle — that character's parts are
authored in its own module under `src/data/` (Nia's is `src/data/nia.ts`) and referenced
by the character's `rig` field. This is still data, still content-agnostic to the renderer,
and still needs no change anywhere in `src/core/` or `src/ui/`. The trade-off is that a
bespoke rig must be maintained by hand, so it is the exception, not the default.

The rig's slots are the contract with the pose and expression libraries: `head`, `torso`,
`armL/R`, `forearmL/R`, `handL/R`, `thighL/R`, `shinL/R`, `footL/R`, `browL/R`, `eyeL/R`,
`nose`, `mouth`, `hairFront`, `hairBack`, `earL/R`, `neck`. A design that needs a slot outside
this set is a rig change and belongs in `src/data/rig.ts` for every character, not one.

A bespoke rig may add **extra slots of its own** for its own layers (a fringe, a hem band,
a belt) — those are inert for the pose and expression libraries. But it must still *have*
the shared slots above, or every shared pose and expression will silently do nothing to it.
Nia's rig keeps all of them and adds `top`, `topBand`, `midriff`, `waistband`, `buckle`,
`pelvis`, `pocketL/R` and `earringR` on top.

---

## 7. PROMPT SCAFFOLD

Prompts are stored in `prompts/` as data, with the tool and its settings recorded beside them,
so a proposal can be reproduced or explained later. A prompt that is not recorded is not a
result.

```
[SUBJECT]        neutral expression, mouth closed, eyes open, looking at camera
[INPUTS]         identity source sheet + current-appearance front/3-4/side
[TASK]           fold the current-appearance landmarks into the identity design;
                 preserve [list the identity features that must not change]
[CONSTRAINTS]    line art / flat colour / plausible for vector tracing;
                 no background, no text, no signature, no extra people
[OUTPUT]         one clean sheet, [front / 3-4 / side] of the same face
[DO NOT]         redesign the character; change the palette; add props or wardrobe
```

Record the exact prompt, the tool and version, the date, and which input files were uploaded
(for privacy traceability).

---

## 8. ACCEPTANCE CHECKLIST

An artifact is only moved into `approved/` when every box for its step passes.

**Merged identity (Gate A)**
- [ ] Reads as the same person from front, 3/4 and side
- [ ] Identity features from the source sheet are preserved, not replaced
- [ ] Current-appearance features are present and recognisable
- [ ] No baked expression, no hard shadow mistaken for a feature
- [ ] Plain background, no text, no watermark, no extra subject

**Vector rig (Gate D)**
- [ ] Renders on the Stage at 1440p and 1920p
- [ ] Every pose in `src/data/poses.ts` resolves without a stray or hidden limb
- [ ] Every expression in `src/data/expressions.ts` reads at the mouth and brows
- [ ] Palette swap restyles the whole character
- [ ] No character-specific branch anywhere in `src/core/` or `src/ui/`

---

## 9. IDENTITY-DRIFT RECOVERY

When a later drawing stops looking like the character, do not "fix" it by eye. Work back to
the frozen sheet:

1. Compare against the Gate C character sheet, not against the last drawing.
2. Identify which landmark ratio has drifted (eye line, jaw width, hairline).
3. Correct that one ratio and re-render; change one thing at a time.
4. If the drift is in the merge itself, re-run from the raw inputs in `references/` — never
   re-merge from a previous merge.

---

## 10. WHAT THIS DOCUMENT DOES NOT DO

- It does not describe a feature. No folder here is read by the application.
- It does not define the character's canon, wardrobe, or personality.
- It does not promise painted art renders now. It does not.
- It does not add a dependency, an API, or a renderer change.

When the [art pipeline](ROADMAP.md) lands and `{ kind: 'image' }` returns with an
`ImageResolver`, this document gains a final section on how `approved/` parts feed it. Until
then, that section would be a placeholder, and it is not written.
