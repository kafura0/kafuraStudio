/**
 * Keyframe sampling and scene state resolution.
 *
 * Pure: `(keyframes, time) -> values`. No document access, so it is trivially
 * testable and safe to call from the render loop.
 */
import type { Clip, Keyframe, KeyframeTarget, Transform2D } from '../types';
/**
 * Sample a keyframe list at an absolute time.
 *
 * Segment easing is read from the keyframe the segment *leaves* (the keyframe
 * before `b`), which is the familiar After Effects convention.
 *
 * - Before the first keyframe: hold the first keyframe's values.
 * - After the last keyframe: hold the last keyframe's values.
 * - Discrete channels (pose, expression, visibility, flip) always hold the start of
 *   the segment and switch at the next keyframe, regardless of easing.
 * - A channel present only on the *later* keyframe is absent until that keyframe is
 *   reached, so the underlying rest value applies up to that point.
 */
export declare function sampleKeyframes(keyframes: Keyframe[], time: number): KeyframeTarget;
/** Sample one clip at an absolute time. Out-of-range clips contribute nothing. */
export declare function sampleClip(clip: Clip, time: number): KeyframeTarget;
/**
 * Merge every active clip for a target into one value set.
 *
 * Later clips win, so an actor can be animated by several sequential clips and the
 * most recently started one takes precedence.
 */
export declare function sampleTarget(clips: Clip[], time: number): KeyframeTarget;
export interface ResolvedCamera extends Transform2D {
    zoom: number;
}
/**
 * Resolve the camera at a time: the scene's rest framing, overridden by any active
 * camera keyframes.
 */
export declare function resolveCamera(rest: {
    x: number;
    y: number;
    zoom: number;
    rotation: number;
}, cameraClips: Clip[], time: number): ResolvedCamera;
/**
 * A cheap stand-in for lip sync: while an actor has an active line, the mouth
 * cycles through open shapes. Real phoneme sync is Phase 16 work; this is enough
 * to keep a talking character from looking frozen, and it is honest about that.
 */
export declare function talkPulseAt(time: number, syllablesPerSecond?: number): number;
