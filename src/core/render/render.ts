/**
 * The renderer.
 *
 * `renderScene(ctx, project, scene, time)` is a pure function: the same project and
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
import { allClips } from '../document/lookups';
import type { Canvas2DLike, ImageLike } from './canvas';
import { resolveCharacter, resolveProp, type ResolvedPart } from './resolve';
import { buildShapePath, shapeBounds } from './shapes';
import type {
  Clip,
  DialogueLine,
  EnvironmentDef,
  ExpressionDef,
  PoseDef,
  Project,
  Scene,
  ShapeDef,
  TrackKind,
  Vec2,
} from '../types';

export interface RenderOptions {
  /** Viewport size. Defaults to the project's authored frame. */
  width?: number;
  height?: number;
  /**
   * Decoded bitmaps by part id, for `{ kind: 'image' }` parts. Supplied by the
   * caller so `core` never loads anything itself.
   */
  images?: Record<string, ImageLike>;
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

const SUBTITLE_FONT = '600 34px "Inter", "Segoe UI", system-ui, sans-serif';
const SUBTITLE_BOX_HEIGHT = 56;
const MAX_SUBTITLE_WIDTH_RATIO = 0.86;

export function renderScene(
  ctx: Canvas2DLike,
  project: Project,
  scene: Scene,
  time: number,
  options: RenderOptions = {},
): void {
  const width = options.width ?? project.settings.width;
  const height = options.height ?? project.settings.height;
  const images = options.images ?? {};
  const pixelRatio = options.pixelRatio ?? 1;

  const environment = project.assets.environments.find((e) => e.id === scene.environmentId);

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
    environment ? environment.width : project.settings.width,
    environment ? environment.height : project.settings.height,
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

  const nodes = collectDrawNodes(ctx, project, scene, time, images);
  for (const node of nodes) node.draw();

  ctx.restore();

  if (options.showFrame && environment) {
    drawFrameBoundary(ctx, environment.width * fit * camera.zoom, environment.height * fit * camera.zoom, width, height);
  }

  ctx.restore();

  if (options.subtitles !== false) {
    drawSubtitle(ctx, scene, time, width, height);
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
  project: Project,
  scene: Scene,
  time: number,
  images: Record<string, ImageLike>,
): DrawNode[] {
  const nodes: DrawNode[] = [];
  let order = 0;

  for (const sceneProp of scene.props) {
    const propDef = project.assets.props.find((p) => p.id === sceneProp.propId);
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
          scale: numberAt(sampled.scaleX, sceneProp.transform.scaleX),
          flipX: boolAt(sampled.flipX, sceneProp.flipX),
          rotation: numberAt(sampled.rotation, sceneProp.transform.rotation),
          alpha: numberAt(sampled.alpha, sceneProp.transform.alpha),
        });
        drawParts(ctx, parts, images);
      },
    });
  }

  for (const actor of scene.actors) {
    const character = project.assets.characters.find((c) => c.id === actor.characterId);
    if (!character) continue;

    const sampled = sampleTarget(scene, 'actor', actor.id, time);
    if (!boolAt(sampled.visible, actor.visible)) continue;

    const pose = findPose(project, stringAt(sampled.poseId, actor.poseId));
    const expression = findExpression(project, stringAt(sampled.expressionId, actor.expressionId));
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
          scale: numberAt(sampled.scaleX, actor.transform.scaleX),
          flipX: boolAt(sampled.flipX, actor.flipX),
          rotation: numberAt(sampled.rotation, actor.transform.rotation),
          alpha: numberAt(sampled.alpha, actor.transform.alpha),
          pose,
          expression,
          mouthScale,
        });
        drawParts(ctx, parts, images);
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
      drawShapeAtPivot(ctx, part.shape, part.colorKey, part.pivot, undefined);
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
    lighting: { ambient: string; overlayColor: string | null; vignette: number };
  },
  cameraX: number,
  cameraY: number,
): void {
  const { lighting, width, height } = environment;

  if (lighting.ambient && lighting.ambient !== 'transparent') {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = lighting.ambient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  if (lighting.overlayColor) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = lighting.overlayColor;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  if (lighting.vignette > 0) {
    const radius = Math.max(width, height) * 0.75;
    const vignette = ctx.createRadialGradient(
      cameraX,
      cameraY,
      radius * 0.45,
      cameraX,
      cameraY,
      radius,
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, `rgba(0,0,0,${Math.min(0.85, lighting.vignette).toFixed(3)})`);
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

export function drawParts(
  ctx: Canvas2DLike,
  parts: ResolvedPart[],
  images: Record<string, ImageLike>,
): void {
  for (const part of parts) {
    if (part.alpha <= 0.001) continue;
    ctx.save();
    ctx.globalAlpha = part.alpha;
    ctx.translate(part.x, part.y);
    ctx.rotate(part.rotation);
    ctx.scale(part.scaleX, part.scaleY);
    drawShapeAtPivot(ctx, part.shape, part.color, part.pivot, images[part.id]);
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
  image: ImageLike | undefined,
): void {
  if (shape.kind === 'image') {
    if (!image) return;
    const bounds = shapeBounds(shape);
    ctx.drawImage(image, -bounds.width * pivot.x, -bounds.height * pivot.y, bounds.width, bounds.height);
    return;
  }

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
): void {
  const text = activeSubtitle(scene, time);
  if (!text) return;

  const maxWidth = width * MAX_SUBTITLE_WIDTH_RATIO;
  const baseline = height - Math.round(height * 0.07);

  ctx.save();
  ctx.font = SUBTITLE_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const boxWidth = Math.min(maxWidth, ctx.measureText(text).width + 48);

  ctx.globalAlpha = 0.82;
  ctx.fillStyle = '#05070c';
  fillRoundRect(ctx, width / 2 - boxWidth / 2, baseline - SUBTITLE_BOX_HEIGHT + 12, boxWidth, SUBTITLE_BOX_HEIGHT, 8);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#f4f6fb';
  ctx.fillText(text, width / 2, baseline - 6, maxWidth);
  ctx.restore();
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

function findPose(project: Project, id: string): PoseDef | null {
  return project.assets.poses.find((p) => p.id === id) ?? null;
}

function findExpression(project: Project, id: string): ExpressionDef | null {
  return project.assets.expressions.find((e) => e.id === id) ?? null;
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
