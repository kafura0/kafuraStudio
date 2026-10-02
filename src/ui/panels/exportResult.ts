/**
 * The sentence that tells an operator what an export actually produced.
 *
 * Separate from the panel because these words are the product's only account of what happened
 * to their work, and they need to be read and tested on their own. Three things can come out
 * of an export, and the one worth being careful about is silence: an episode with no audio in
 * it mixes to a file of the right length containing nothing. "A 0-segment mixdown" reads like
 * a successful, if small, export, and an operator is entitled to ship that file believing a
 * room tone was under the scene.
 */
export function describeResult(frames: number, placed: number, missing: number): string {
  if (missing > 0) {
    // A segment that could not be mixed is not a blemish on a successful export, so it leads
    // the sentence instead of being appended to a count that would otherwise read as a pass.
    return `Exported ${frames} frames. ${missing} audio segment(s) could not be mixed and are listed below.`;
  }
  if (placed === 0) {
    return `Exported ${frames} frames. The mixdown is silent: no audio is placed in this episode, so the WAV has nothing in it.`;
  }
  return `Exported ${frames} frames and a ${placed}-segment mixdown.`;
}
