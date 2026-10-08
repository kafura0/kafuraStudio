/**
 * The renderer.
 *
 * `renderScene(ctx, context, scene, time)` is a pure function: the same context and
 * time always produce the same pixels, with no retained state anywhere. That single
 * property buys three things at once — deterministic unit tests, frame-accurate
 * export, and an editor loop that can redraw from scratch after any undo.
 *
 * Draw order, back to front:
 *   1. scene background
 *   2. environment layers, ascending `z`, parallaxed against the camera
 *   3. environment lighting wash + vignette
 *   4. scene props and actors, merged and sorted by `z`
 *   5. subtitles
 */

import { fitScale } from '../geometry';
import { resolveCamera, sampleKeyframes, talkPulseAt } from '../animation/sample';
import {
  allClips,
  findExpression as lookupExpression,
  findPose as lookupPose,
} from '../document/lookups';
import type { Canvas2DLike } from './canvas';
import { resolveCharacter, resolveProp, type ResolvedPart } from './resolve';
import { buildShapePath, shapeBounds } from './shapes';
import type {
  Clip,
  DialogueLine,
  EnvironmentDef,
  ExpressionDef,
  Lighting,
  PoseDef,
  ProjectSettings,
  Scene,
  SceneContext,
  ShapeDef,
  SubtitleStyle,
  TrackKind,
  Vec2,
} from '../types';

export interface RenderOptions {
  /** Viewport size. Defaults to the context's authored frame. */
  width?: number;
  height?: number;
  /**
   * Device pixel ratio of the target surface, as a plain number. `core` cannot read
   * `window.devicePixelRatio`, so the caller supplies it.
   *
   * `renderScene` establishes its own transform from this value rather than
   * inheriting the caller's, so the same call renders identically at any ratio and
   * nothing ambient can leak in. Defaults to 1.
   */
  pixelRatio?: number;
  /** Draw the subtitle bar. On by default. */
  subtitles?: boolean;
  /** Draw the environment frame boundary. An editor aid; off by default. */
  showFrame?: boolean;
}

/** Everything a single rig part needs in order to be blitted. */
interface DrawNode {
  z: number;
  order: number;
  draw(): void;
}

/**
 * The subtitle presentation when a document says nothing about it.
 *
 * Today's pixels: the colour pair, the box, the cap share of the stage width — all
 * reproduce what the renderer drew when these were module constants. A document may
 * override any field via `ProjectSettings.subtitleStyle` (§18.3 R8).
 */
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  font: '600 34px "Inter", "Segoe UI", system-ui, sans-serif',
  textColor: '#f4f6fb',
  boxColor: '#05070c',
  boxOpacity: 0.82,
  boxHeight: 56,
  lineHeight: 40,
  maxWidthRatio: 0.86,
};

/** The style a document's settings resolve to, defaults filling any absent field. */
function subtitleStyleOf(settings: ProjectSettings): SubtitleStyle {
  return { ...DEFAULT_SUBTITLE_STYLE, ...settings.subtitleStyle };
}

/**
 * Lighting strengths when an environment says nothing about them (§18.3 R9).
 *
 * Today's pixels: the numbers the renderer once hardcoded. An environment that never
 * declared the fields draws exactly as it always did, and a declared value overrides
 * only itself.
 */
export const DEFAULT_LIGHTING = {
  ambientOpacity: 0.28,
  overlayOpacity: 0.18,
  vignetteOpacity: 0.85,
  vignetteRadius: 0.75,
} as const;

/**
 * The vignette gradient's two colour stops.
 *
 * The second stop is the environment's `vignette` strength capped at `opacity` — the
 * cap is what stops a document from painting an opaque black oval over its own scene.
 * Exported because it is a string built from two numbers, and a draw-log test is the
 * only way to pin the exact value the pixels get.
 */
export function vignetteStops(vignette: number, opacity: number): [string, string] {
  return ['rgba(0,0,0,0)', `rgba(0,0,0,${Math.min(opacity, vignette).toFixed(3)})`];
}

export function renderScene(
  ctx: Canvas2DLike,
  context: SceneContext,
  scene: Scene,
  time: number,
  options: RenderOptions = {},
): void {
  const width = options.width ?? context.settings.width;
  const height = options.height ?? context.settings.height;
  const pixelRatio = options.pixelRatio ?? 1;

  const environment = context.assets.environments.find((e) => e.id === scene.environmentId);

  ctx.save();
  // Establish the base transform explicitly. Deriving it from `pixelRatio` rather
  // than inheriting the caller's is what makes a 2x surface render the same image at
  // twice the resolution instead of at half size in one corner: the caller sizes the
  // backing store, this function decides how to fill it.
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = scene.backgroundColor;
  ctx.fillRect(0, 0, width, height);

  const camera = resolveCamera(
    scene.camera,
    clipsFor(scene, 'camera'),
    time,
  );

  // Fit the authored environment frame into the viewport, then apply the camera on
  // top of that fit so a scene never letterboxes differently per window size.
  const fit = fitScale(
    environment ? environment.width : context.settings.width,
    environment ? environment.height : context.settings.height,
    width,
    height,
  );

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(camera.rotation);
  ctx.scale(camera.zoom * fit, camera.zoom * fit);
  ctx.translate(-camera.x, -camera.y);

  if (environment) {
    drawEnvironment(ctx, environment, camera.x, camera.y);
    drawLighting(ctx, environment, camera.x, camera.y);
  }

  const nodes = collectDrawNodes(ctx, context, scene, time);
  for (const node of nodes) node.draw();

  ctx.restore();

  if (options.showFrame && environment) {
    drawFrameBoundary(ctx, environment.width * fit * camera.zoom, environment.height * fit * camera.zoom, width, height);
  }

  ctx.restore();

  if (options.subtitles !== false) {
    drawSubtitle(ctx, scene, time, width, height, subtitleStyleOf(context.settings));
  }
}

/* ------------------------------------------------------------------ */
/* Scene contents                                                      */
/* ------------------------------------------------------------------ */

/**
 * Resolve every visible prop and actor into a single depth-sorted draw list.
 *
 * Props and actors share one `z` space so a mug can sit in front of a character and
 * the couch can sit behind them, which is the whole point of a depth-sorted
 * compositor.
 */
function collectDrawNodes(
  ctx: Canvas2DLike,
  context: SceneContext,
  scene: Scene,
  time: number,
): DrawNode[] {
  const nodes: DrawNode[] = [];
  let order = 0;

  for (const sceneProp of scene.props) {
    const propDef = context.assets.props.find((p) => p.id === sceneProp.propId);
    if (!propDef) continue;

    const sampled = sampleTarget(scene, 'prop', sceneProp.id, time);
    if (!boolAt(sampled.visible, sceneProp.visible)) continue;

    const nodeOrder = order++;
    const z = sceneProp.z;
    nodes.push({
      z,
      order: nodeOrder,
      draw: () => {
        const parts = resolveProp(propDef, {
          origin: { x: numberAt(sampled.x, sceneProp.transform.x), y: numberAt(sampled.y, sceneProp.transform.y) },
          scaleX: numberAt(sampled.scaleX, sceneProp.transform.scaleX),
          scaleY: numberAt(sampled.scaleY, sceneProp.transform.scaleY),
          flipX: boolAt(sampled.flipX, sceneProp.flipX),
          rotation: numberAt(sampled.rotation, sceneProp.transform.rotation),
          alpha: numberAt(sampled.alpha, sceneProp.transform.alpha),
        });
        drawParts(ctx, parts);
      },
    });
  }

  for (const actor of scene.actors) {
    const character = context.assets.characters.find((c) => c.id === actor.characterId);
    if (!character) continue;

    const sampled = sampleTarget(scene, 'actor', actor.id, time);
    if (!boolAt(sampled.visible, actor.visible)) continue;

    const pose = findPose(context, stringAt(sampled.poseId, actor.poseId));
    const expression = findExpression(context, stringAt(sampled.expressionId, actor.expressionId));
    const mouthScale = isActorTalking(scene, actor.id, time) ? talkPulseAt(time) : 1;

    const nodeOrder = order++;
    const z = actor.z;
    nodes.push({
      z,
      order: nodeOrder,
      draw: () => {
        const parts = resolveCharacter(character, {
          origin: {
            x: numberAt(sampled.x, actor.transform.x),
            y: numberAt(sampled.y, actor.transform.y),
          },
          scaleX: numberAt(sampled.scaleX, actor.transform.scaleX),
          scaleY: numberAt(sampled.scaleY, actor.transform.scaleY),
          flipX: boolAt(sampled.flipX, actor.flipX),
          rotation: numberAt(sampled.rotation, actor.transform.rotation),
          alpha: numberAt(sampled.alpha, actor.transform.alpha),
          pose,
          expression,
          mouthScale,
          mouthSlot: character.mouthSlot,
        });
        drawParts(ctx, parts);
      },
    });
  }

  nodes.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.order - b.order));
  return nodes;
}

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

function drawEnvironment(
  ctx: Canvas2DLike,
  environment: EnvironmentDef,
  cameraX: number,
  cameraY: number,
): void {
  const layers = [...environment.layers].sort((a, b) => a.z - b.z);

  for (const layer of layers) {
    // Parallax: a layer with parallax > 1 reads as further away and drifts less
    // under camera movement; < 1 drifts more. A zero parallax pins the layer.
    const parallax = layer.parallax === 0 ? 1 : layer.parallax;
    const dx = (cameraX - environment.width / 2) * (1 - 1 / parallax);
    const dy = (cameraY - environment.height / 2) * (1 - 1 / parallax);

    ctx.save();
    ctx.translate(dx, dy);
    for (const part of layer.parts) {
      ctx.save();
      ctx.globalAlpha = part.transform.alpha;
      ctx.translate(part.transform.x, part.transform.y);
      ctx.rotate(part.transform.rotation);
      ctx.scale(part.transform.scaleX, part.transform.scaleY);
      // Environment parts carry a literal colour; only characters get a palette.
      drawShapeAtPivot(ctx, part.shape, part.colorKey, part.pivot);
      ctx.restore();
    }
    ctx.restore();
  }
}

function drawLighting(
  ctx: Canvas2DLike,
  environment: {
    width: number;
    height: number;
    lighting: Lighting;
  },
  cameraX: number,
  cameraY: number,
): void {
  const { lighting, width, height } = environment;

  if (lighting.ambient && lighting.ambient !== 'transparent') {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = lighting.ambientOpacity ?? DEFAULT_LIGHTING.ambientOpacity;
    ctx.fillStyle = lighting.ambient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  if (lighting.overlayColor) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = lighting.overlayOpacity ?? DEFAULT_LIGHTING.overlayOpacity;
    ctx.fillStyle = lighting.overlayColor;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  if (lighting.vignette > 0) {
    const radius = Math.max(width, height) * (lighting.vignetteRadius ?? DEFAULT_LIGHTING.vignetteRadius);
    const vignette = ctx.createRadialGradient(
      cameraX,
      cameraY,
      radius * 0.45,
      cameraX,
      cameraY,
      radius,
    );
    const [inner, outer] = vignetteStops(
      lighting.vignette,
      lighting.vignetteOpacity ?? DEFAULT_LIGHTING.vignetteOpacity,
    );
    vignette.addColorStop(0, inner);
    vignette.addColorStop(1, outer);
    ctx.save();
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}

function drawFrameBoundary(
  ctx: Canvas2DLike,
  frameWidthPx: number,
  frameHeightPx: number,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  const x = Math.round(width / 2 - frameWidthPx / 2) + 0.5;
  const y = Math.round(height / 2 - frameHeightPx / 2) + 0.5;
  ctx.strokeRect(x, y, Math.round(frameWidthPx), Math.round(frameHeightPx));
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Parts + shapes                                                      */
/* ------------------------------------------------------------------ */

export function drawParts(ctx: Canvas2DLike, parts: ResolvedPart[]): void {
  for (const part of parts) {
    if (part.alpha <= 0.001) continue;
    ctx.save();
    ctx.globalAlpha = part.alpha;
    ctx.translate(part.x, part.y);
    ctx.rotate(part.rotation);
    ctx.scale(part.scaleX, part.scaleY);
    drawShapeAtPivot(ctx, part.shape, part.color, part.pivot);
    ctx.restore();
  }
}

/**
 * Draw a shape with its declared pivot at the current origin.
 *
 * Shapes are authored centred on their own bounding box, so the offset to apply is
 * `-pivot * size`. That one rule is what lets a rig rotate a limb around its joint
 * without any per-shape special case.
 */
function drawShapeAtPivot(
  ctx: Canvas2DLike,
  shape: ShapeDef,
  color: string,
  pivot: Vec2,
): void {
  const bounds = shapeBounds(shape);
  ctx.save();
  ctx.translate(-bounds.width * pivot.x, -bounds.height * pivot.y);
  buildShapePath(ctx, shape);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Subtitles                                                           */
/* ------------------------------------------------------------------ */

function drawSubtitle(
  ctx: Canvas2DLike,
  scene: Scene,
  time: number,
  width: number,
  height: number,
  style: SubtitleStyle,
): void {
  const text = activeSubtitle(scene, time);
  if (!text) return;

  const maxWidth = width * style.maxWidthRatio;
  const baseline = height - Math.round(height * 0.07);

  ctx.save();
  ctx.font = style.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // A line that fits stays one line, byte for byte as before. One that does not is
  // wrapped into a two-line stack rather than squashed by `fillText`'s `maxWidth`.
  const lines = wrapSubtitle(text, maxWidth, (line) => ctx.measureText(line).width);
  const first = lines[0] ?? text;
  const second = lines[1];

  const textWidth = second
    ? Math.max(ctx.measureText(first).width, ctx.measureText(second).width)
    : ctx.measureText(first).width;
  const boxWidth = Math.min(maxWidth, textWidth + 48);
  const boxHeight = style.boxHeight + (second ? style.lineHeight : 0);

  ctx.globalAlpha = style.boxOpacity;
  ctx.fillStyle = style.boxColor;
  fillRoundRect(ctx, width / 2 - boxWidth / 2, baseline - boxHeight + 12, boxWidth, boxHeight, 8);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.fillStyle = style.textColor;
  if (second) {
    ctx.fillText(first, width / 2, baseline - 6 - style.lineHeight);
    ctx.fillText(second, width / 2, baseline - 6);
  } else {
    ctx.fillText(first, width / 2, baseline - 6, maxWidth);
  }
  ctx.restore();
}

/**
 * Split a subtitle into at most two lines that each fit `maxWidth`.
 *
 * A subtitle that already fits is returned whole — an unchanged single line, so an
 * existing document draws exactly as before. The stack is greedy per word, and a word
 * wider than the allowance alone still gets a line of its own rather than being
 * squashed. Anything that would need a third line is cut with an ellipsis: a ZANZA
 * subtitle is two lines, and text arriving mid-sentence is honestly truncated rather
 * than silently dropped.
 */
export function wrapSubtitle(
  text: string,
  maxWidth: number,
  measure: (line: string) => number,
): string[] {
  const whole = text.trim();
  if (whole.length === 0) return [];
  if (measure(whole) <= maxWidth) return [whole];

  const words = whole.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current !== '') lines.push(current);
    current = '';
  };

  for (const word of words) {
    if (current === '') {
      current = word;
      continue;
    }
    const candidate = `${current} ${word}`;
    if (measure(candidate) > maxWidth) {
      flush();
      // A third line needs to start, but a subtitle is two lines. The remainder is
      // cut off with an ellipsis so the truncation is visible rather than silent.
      if (lines.length === 2) {
        lines[1] = `${lines[1]}…`;
        return lines;
      }
      current = word;
    } else {
      current = candidate;
    }
  }
  flush();
  return lines;
}

function fillRoundRect(
  ctx: Canvas2DLike,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/* ------------------------------------------------------------------ */
/* Sampling helpers                                                    */
/* ------------------------------------------------------------------ */

/** Every unmuted clip of a kind, regardless of time. */
function clipsFor(scene: Scene, kind: TrackKind): Clip[] {
  const clips: Clip[] = [];
  for (const track of scene.tracks) {
    if (track.kind !== kind || track.muted) continue;
    clips.push(...track.clips);
  }
  return clips;
}

type SampledValue = string | number | boolean | undefined;
type Sampled = Partial<Record<'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'alpha' | 'poseId' | 'expressionId' | 'visible' | 'flipX', SampledValue>>;

/**
 * Keyframed values for one target at a time, merged across every active clip.
 * Later-started clips win, so sequential clips on one track compose naturally.
 */
function sampleTarget(scene: Scene, kind: 'actor' | 'prop', targetId: string, time: number): Sampled {
  const active: Clip[] = [];
  for (const track of scene.tracks) {
    if (track.kind !== kind || track.targetId !== targetId || track.muted) continue;
    for (const clip of track.clips) {
      if (time >= clip.start && time < clip.start + clip.duration) active.push(clip);
    }
  }
  if (active.length === 0) return {};

  active.sort((a, b) => a.start - b.start);
  const out: Sampled = {};
  for (const clip of active) {
    if (clip.keyframes.length === 0) continue;
    Object.assign(out, sampleKeyframes(clip.keyframes, time));
  }
  return out;
}

function numberAt(sampled: SampledValue, fallback: number): number {
  return typeof sampled === 'number' && Number.isFinite(sampled) ? sampled : fallback;
}

function boolAt(sampled: SampledValue, fallback: boolean): boolean {
  return typeof sampled === 'boolean' ? sampled : fallback;
}

function stringAt(sampled: SampledValue, fallback: string): string {
  return typeof sampled === 'string' ? sampled : fallback;
}

// Delegates to the shared lookups rather than scanning `context.assets` inline. The
// difference is not stylistic: `findPose` takes a resolved library, so there is no way for
// the renderer to accidentally search the project's override collection in isolation and
// report a series pose as missing.
function findPose(context: SceneContext, id: string): PoseDef | null {
  return lookupPose(context.assets, id) ?? null;
}

function findExpression(context: SceneContext, id: string): ExpressionDef | null {
  return lookupExpression(context.assets, id) ?? null;
}

/** The subtitle text under the playhead, or null when nothing is being said. */
export function activeSubtitle(scene: Scene, time: number): string | null {
  for (const { track, clip } of allClips(scene)) {
    if (track.kind !== 'dialogue' || track.muted || clip.dialogueLineId === null) continue;
    if (time < clip.start || time >= clip.start + clip.duration) continue;
    const line = scene.dialogue.find((d) => d.id === clip.dialogueLineId);
    if (line) return line.subtitle ?? line.text;
  }
  return null;
}

/** The dialogue line under the playhead, joined with the actor delivering it. */
export function activeDialogue(scene: Scene, time: number): DialogueLine | null {
  for (const { track, clip } of allClips(scene)) {
    if (track.kind !== 'dialogue' || track.muted || clip.dialogueLineId === null) continue;
    if (time < clip.start || time >= clip.start + clip.duration) continue;
    return scene.dialogue.find((d) => d.id === clip.dialogueLineId) ?? null;
  }
  return null;
}

/** True when an actor has an unmuted dialogue line playing right now. */
export function isActorTalking(scene: Scene, actorId: string, time: number): boolean {
  for (const { track, clip } of allClips(scene)) {
    if (track.kind !== 'dialogue' || track.muted || clip.dialogueLineId === null) continue;
    if (time < clip.start || time >= clip.start + clip.duration) continue;
    const line = scene.dialogue.find((d) => d.id === clip.dialogueLineId);
    if (line?.actorId === actorId) return true;
  }
  return false;
}
