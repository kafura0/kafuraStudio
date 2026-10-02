/**
 * What this browser can actually export, checked rather than assumed.
 *
 * Step 7 of Phase 12 is a panel, and a panel that offers an export the browser will
 * refuse is worse than one that does not offer it: the user discovers the refusal after
 * waiting, and cannot tell whether the work is lost or the button is broken. So the
 * capabilities are detected once, up front, and each one carries a reason. A capability
 * that is absent is reported with *why*, which is the difference between "this browser
 * cannot" and "something is wrong".
 *
 * The asymmetry is deliberate: PNG still and PNG sequence need only a 2D canvas, so they
 * are available essentially everywhere, and the panel says so. Video is reported
 * unavailable everywhere, because ADR 001 chose a route for it and did not build it — the
 * capability list is about what this app can do, not about what the browser can.
 *
 * Nothing here creates a canvas or an audio context. Detection must be cheap, because it
 * runs on mount, and a check that allocated a full-size surface to ask "can you" would
 * cost more than the export it was gating.
 */

export type ExportCapability =
  | 'png-still'
  | 'png-sequence'
  | 'audio-mixdown'
  | 'video-webm';

export interface Capability {
  available: boolean;
  /** Why it is unavailable, for the operator. Never empty when `available` is false. */
  reason: string;
}

export type ExportCapabilities = Record<ExportCapability, Capability>;

interface BrowserWindow {
  OfflineAudioContext?: typeof OfflineAudioContext;
  webkitOfflineAudioContext?: typeof OfflineAudioContext;
}

/**
 * Detect what this browser can do.
 *
 * Only two things are actually probed, because only two things are implemented. A
 * capability that is hard-coded unavailable is still worth listing: the operator can see
 * that video was considered and why it is not on offer, which is more use than a silently
 * absent row.
 */
export function detectExportCapabilities(): ExportCapabilities {
  const windowWithMedia = globalThis as BrowserWindow;

  const canRasterise = typeof document !== 'undefined' && has2dContext();
  const canEncodeAudio =
    windowWithMedia.OfflineAudioContext !== undefined ||
    windowWithMedia.webkitOfflineAudioContext !== undefined;

  const pngReason = canRasterise
    ? ''
    : 'This browser has no Canvas 2D context, so frames cannot be rasterised.';

  return {
    'png-still': {
      available: canRasterise,
      reason: pngReason,
    },
    'png-sequence': {
      available: canRasterise,
      reason: pngReason,
    },
    'audio-mixdown': {
      available: canEncodeAudio,
      reason: canEncodeAudio
        ? ''
        : 'This browser has no OfflineAudioContext, so audio cannot be rendered offline.',
    },
    // ADR 001 chose `MediaRecorder` as the only no-dependency video route, and did not
    // build it. It is reported unavailable on *every* browser, including one with a
    // perfectly good `MediaRecorder`, because the question this panel answers is "can this
    // app export video", not "does this browser have a recorder". Detecting the API and
    // then reporting the capability as available would be a claim about a path that does
    // not exist, and a user who pressed it would be pressing a button that was never wired.
    'video-webm': {
      available: false,
      reason: VIDEO_NOT_BUILT,
    },
  };
}

/**
 * Why video is off, in the operator's terms.
 *
 * Points at the decision rather than at the absence of an API, because "this browser
 * cannot record WebM" would be untrue in most browsers and would send someone looking for a
 * browser problem that does not exist.
 */
const VIDEO_NOT_BUILT =
  'One-file video is not built in this phase (ADR 001). The PNG sequence and the audio mixdown are the export.';

/**
 * A 1x1 throwaway surface, freed immediately. Cheaper than a full-size one.
 *
 * `getContext` can return `null` (no 2D support) *or* `undefined` (an environment that
 * does not implement it, which is what jsdom does). Both mean "cannot rasterise", so the
 * check is `!= null` rather than `!== null`. Testing against `null` alone would report
 * every export as available in an environment that has no canvas at all, which is the exact
 * failure this function exists to prevent.
 */
function has2dContext(): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context: unknown = canvas.getContext('2d');
    const ok = context !== null && context !== undefined;
    canvas.width = 0;
    canvas.height = 0;
    return ok;
  } catch {
    return false;
  }
}

/** True when every capability the phase's gate needs is present. */
export function canExportGate(capabilities: ExportCapabilities): boolean {
  return capabilities['png-sequence'].available && capabilities['audio-mixdown'].available;
}
