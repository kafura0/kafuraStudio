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
import type { Canvas2DLike, ImageLike } from './canvas';
import { type ResolvedPart } from './resolve';
import type { DialogueLine, Project, Scene } from '../types';
export interface RenderOptions {
    /** Viewport size. Defaults to the project's authored frame. */
    width?: number;
    height?: number;
    /**
     * Decoded bitmaps by part id, for `{ kind: 'image' }` parts. Supplied by the
     * caller so `core` never loads anything itself.
     */
    images?: Record<string, ImageLike>;
    /** Draw the subtitle bar. On by default. */
    subtitles?: boolean;
    /** Draw the environment frame boundary. An editor aid; off by default. */
    showFrame?: boolean;
}
export declare function renderScene(ctx: Canvas2DLike, project: Project, scene: Scene, time: number, options?: RenderOptions): void;
export declare function drawParts(ctx: Canvas2DLike, parts: ResolvedPart[], images: Record<string, ImageLike>): void;
/** The subtitle text under the playhead, or null when nothing is being said. */
export declare function activeSubtitle(scene: Scene, time: number): string | null;
/** The dialogue line under the playhead, joined with the actor delivering it. */
export declare function activeDialogue(scene: Scene, time: number): DialogueLine | null;
/** True when an actor has an unmuted dialogue line playing right now. */
export declare function isActorTalking(scene: Scene, actorId: string, time: number): boolean;
