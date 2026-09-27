# ZANZA STUDIO — DATA MODEL

> Canonical reference for every persisted shape. The TypeScript in
> `src/core/types.ts` is the executable version of this document; if they disagree,
> the TypeScript is a bug.

---

## 0. FILE FORMAT

```jsonc
{
  "formatVersion": 1,
  "project": { /* see §7 */ }
}
```

- `formatVersion` enables forward migration (`migrateProject`). Bump it whenever a
  persisted shape changes and append a migration step.
- **Media is never embedded.** Audio and images are referenced by `src` (a URL or
  an IndexedDB blob key). The JSON stays diffable and versionable in git.

---

## 1. GEOMETRY PRIMITIVES

```ts
interface Vec2      { x: number; y: number }
interface Transform2D {
  x: number; y: number;        // translation, px, in parent space
  rotation: number;            // radians
  scaleX: number; scaleY: number;
  alpha: number;               // 0..1
}
```

Default `Transform2D` = `{ x:0, y:0, rotation:0, scaleX:1, scaleY:1, alpha:1 }`.

---

## 2. VECTOR PARTS — THE RIG

A character, prop, or environment element is composed of **parts**. Every part has a
**slot** (the rig joint it represents), an optional **parent** part, a **pivot**, and
a **rest transform**. Nesting is a flat list plus a `parent` pointer, resolved into
a transform stack — no recursive types.

```ts
type ShapeDef =
  | { kind: 'ellipse';   rx: number; ry: number }
  | { kind: 'rect';      w: number; h: number }
  | { kind: 'roundRect'; w: number; h: number; radius: number }
  | { kind: 'path';      points: Vec2[]; closed: boolean }
  | { kind: 'image';     src: string; w: number; h: number };

interface PartDef {
  id: string;
  slot: string;              // 'head' | 'torso' | 'armL' | 'mouth' | ... (free-form)
  parent: string | null;     // parent part id, or null for a root part
  z: number;                 // draw order within the rig
  shape: ShapeDef;
  colorKey: string;          // palette slot name OR a literal '#rrggbb'
  pivot: Vec2;               // normalised 0..1 rotation/scale pivot within the shape
  rest: Transform2D;         // rest transform relative to the parent
  visible: boolean;
}
```

**Why `slot` is a free-form string.** A pose names slots. If slots were a closed
union, every new character design would be a type change. Free-form strings mean a
pose addressing `armL` works for any character that happens to have an `armL` part,
and is inert for one that does not. This is what makes poses reusable.

`colorKey` resolves against `CharacterDef.palette`, falling back to being treated as
a literal CSS colour. That is how one palette swap restyles an entire character.

---

## 3. POSE AND EXPRESSION — TRANSFORM OVERRIDE LAYERS

```ts
interface SlotOverride {          // every field optional — a partial override
  x?: number; y?: number;
  rotation?: number;              // radians, ADDITIVE to the rest rotation
  scaleX?: number; scaleY?: number;   // MULTIPLICATIVE on the rest scale
  alpha?: number;                 // MULTIPLICATIVE
  visible?: boolean;
  shape?: ShapeDef;               // swap geometry (expression work)
  colorKey?: string;              // recolour (expression work)
}

interface PoseDef       { id; name; description; tags: string[]; slots: Record<string, SlotOverride> }
interface ExpressionDef { id; name; description; tags: string[]; slots: Record<string, SlotOverride> }
```

A **pose** is a body arrangement. An **expression** is a face. They are the same
type because they are the same mechanism — partial slot overrides — and one unified
mechanism means one resolution function, one set of tests.

Composition order at render time:

```
rest  <-  pose  <-  keyframe
```

later layers win. The mouth is an ordinary part with slot `mouth`, so "angry" is
just `mouth: <frown shape> + browL: rotate(+8deg)`. No dedicated mouth pipeline.

---

## 4. CHARACTER

```ts
interface CharacterDef {
  id: string;
  name: string;
  description: string;
  tags: string[];
  palette: Record<string, string>;   // { skin: '#...', hair: '#...', top: '#...' }
  rig: PartDef[];
  height: number;                    // px tall at scale 1; feet sit at y = 0
  defaultPoseId: string;
  defaultExpressionId: string;
}
```

`height` exists so the stage can offer "scale to 85% of frame height" and so
`getCharacterHeadY()` can position a close-up crop. The renderer never hardcodes a
character's proportions.

---

## 5. ENVIRONMENT

```ts
interface StagingAnchor {
  id: string;
  name: string;              // 'Nia_Couch'
  x: number; y: number;      // where the actor's FEET land
  scale: number;
  rotation: number;
  flipX: boolean;
  facing: 'left' | 'right';
  kind: 'stand' | 'sit' | 'door' | 'table' | 'floor';
  tags: string[];
}

interface EnvPart { id: string; shape: ShapeDef; colorKey: string; pivot: Vec2; transform: Transform2D }
interface EnvLayer { id: string; name: string; z: number; parallax: number; parts: EnvPart[] }

interface EnvironmentDef {
  id: string;
  name: string;
  description: string;
  tags: string[];
  width: number; height: number;     // the authored camera frame
  layers: EnvLayer[];                // background | midground | foreground, by `z`
  anchors: StagingAnchor[];
  lighting: { ambient: string; overlayColor: string | null; vignette: number };
}
```

**Anchors are the composition system.** A scene does not hand-place characters with
raw coordinates every time; it binds an actor to an anchor
(`Nia_Couch`, `Kito_Door`). Re-staging an episode is then a matter of moving
anchors, and every scene built on that environment inherits the change. This is the
"repeatable composition" goal in the brief, expressed as data.

`parallax` (>1 = further than the camera, <1 = nearer) is retained per layer so a
push-in can separate planes without a second environment definition.

---

## 6. PROPS, AUDIO

```ts
interface PropDef {
  id: string; name: string; description: string; tags: string[];
  parts: PartDef[];          // same rig structure as a character
  pivot: Vec2;
  defaultScale: number;
}

interface AudioDef {
  id: string; name: string;
  kind: 'dialogue' | 'sfx' | 'music' | 'ambience';
  src: string | null;        // null = a slot that is defined but not yet loaded
  duration: number;          // seconds
  tags: string[];
}
```

Props reuse `PartDef`, so the renderer draws a character and a mug through the same
code path. One `drawRig()` function. `src: null` is legitimate — it lets the
timeline be authored before the recording exists.

---

## 7. SCENE

```ts
interface SceneActor {
  id: string;
  characterId: string;        // -> CharacterDef        (reference, never a copy)
  poseId: string;             // -> PoseDef
  expressionId: string;       // -> ExpressionDef
  displayName: string;
  transform: Transform2D;     // placement only — no rig data
  flipX: boolean;
  z: number;
  visible: boolean;
  anchorId: string | null;    // bound StagingAnchor, or null for free placement
}

interface SceneProp  { id: string; propId: string; transform: Transform2D; flipX: boolean; z: number; visible: boolean }
interface Camera     { x: number; y: number; zoom: number; rotation: number }
interface DialogueLine {
  id: string;
  speaker: string;            // display name of the speaking actor
  actorId: string | null;     // links the line to a SceneActor (drives mouth/expression)
  text: string;
  emotion: string;            // free-form, drives the auto-picked expression
  voiceAudioId: string | null;   // -> AudioDef
  subtitle: string | null;    // null => use `text`
}

interface Scene {
  id: string;
  name: string;
  description: string;
  environmentId: string;      // -> EnvironmentDef
  actors: SceneActor[];
  props: SceneProp[];
  dialogue: DialogueLine[];
  tracks: Track[];
  camera: Camera;
  duration: number;           // seconds
  backgroundColor: string;
  metadata: Record<string, string>;
}
```

Note what is **absent**: no character definition, no rig, no palette. `SceneActor`
can only hold ids. Copying a character into a scene is not representable, which is
how RULE 2 is enforced by the type system rather than by discipline.

`Scene` carries a `camera` rest state. Camera *animation* lives in keyframes on a
`camera` track; the rest value is the shot's framing when nothing is keyed.

---

## 8. TIMELINE

```ts
type TrackKind = 'actor' | 'prop' | 'camera' | 'dialogue' | 'audio';
type EaseType  = 'linear' | 'step' | 'easeInOut' | 'easeOut';

interface KeyframeTarget extends Partial<Transform2D> {
  poseId?: string;
  expressionId?: string;
  flipX?: boolean;
  visible?: boolean;
}

interface Keyframe { id: string; time: number; ease: EaseType; props: KeyframeTarget }

interface Clip {
  id: string;
  start: number;              // seconds on the scene timeline
  duration: number;           // seconds
  keyframes: Keyframe[];      // keyframe.time is ABSOLUTE (scene time)
  audioId: string | null;     // for kind 'audio' | 'dialogue'
  dialogueLineId: string | null;  // for kind 'dialogue'
  gain: number;               // audio gain 0..2
}

interface Track {
  id: string;
  kind: TrackKind;
  targetId: string;
  name: string;
  muted: boolean;
  locked: boolean;
  color: string;
  clips: Clip[];        // always sorted ascending by `start`
}
```

**One model for everything.** Characters, props, camera, dialogue and audio are all
`Track -> Clip -> (Keyframe | payload)`. The timeline UI is therefore written once
and extended by adding a track kind, not a new widget.

**Timing lives on the clip. Content lives on the line.** A `DialogueLine` has no
`start`/`duration`; its `Clip` does. Dragging the clip moves the line. There is no
second copy of the timing to fall out of sync.

`targetId` is a `SceneActor.id`, `SceneProp.id`, the literal `'camera'`, a
`DialogueLine.id`, or an `AudioDef.id`, depending on `kind`.

**Easing.** `ease` governs the **numeric** channels (`x`, `y`, `rotation`, `scaleX`,
`scaleY`, `alpha`) across the segment the keyframe *leaves* — the familiar After
Effects convention. The default is `linear`.

**Discrete channels never interpolate.** `poseId`, `expressionId`, `visible` and
`flipX` hold the start of a segment and switch at the next keyframe, whatever the
easing. An expression *cuts*, it does not smear between two faces. Use `ease:
'step'` to make motion stepped as well.

A channel present only on the later keyframe is **absent** until that keyframe is
reached, so the character's scene-authored rest value applies up to that point.

---

## 9. EPISODE

```ts
interface RenderSettings { width: number; height: number; fps: number; format: 'webm' | 'png-sequence' }

interface Episode {
  id: string;
  title: string;
  description: string;
  sceneIds: string[];         // ORDER IS THE CUT LIST
  renderSettings: RenderSettings;
  metadata: Record<string, string>;
}
```

Scenes live in a **flat** `project.scenes` array and the episode holds the order.
Nested scenes would make "find scene by id" an O(n) walk on every render frame and
would make moving a scene between episodes a data migration.

---

## 10. PROJECT

```ts
interface AssetLibrary {
  characters: CharacterDef[];
  environments: EnvironmentDef[];
  poses: PoseDef[];
  expressions: ExpressionDef[];
  props: PropDef[];
  audio: AudioDef[];
}

interface ProjectSettings { width: number; height: number; fps: number; autosave: boolean }

interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;          // ISO 8601
  updatedAt: string;
  formatVersion: number;
  settings: ProjectSettings;
  assets: AssetLibrary;
  episodes: Episode[];
  scenes: Scene[];
}
```

## 11. INVARIANTS

Enforced by tests in `src/core/document/invariants.test.ts`:

1. Every `SceneActor.characterId` resolves to a `CharacterDef`.
2. Every `SceneActor.poseId` / `expressionId` resolves.
3. Every `Scene.environmentId` resolves.
4. Every `SceneProp.propId` resolves.
5. Every `Track` and `Clip` `targetId` resolves.
6. Every `DialogueLine.voiceAudioId` resolves or is `null`.
7. Every `Episode.sceneIds` resolves, in order, without duplicates.
8. Keyframe times fall within their clip; clips fall within `[0, scene.duration]`.
9. `parseProject` rejects a document violating any of the above.
10. Adding a character to `assets.characters` requires **no** change to any code in
    `core/` — asserted by rendering and operating on a synthetic puppet character.
