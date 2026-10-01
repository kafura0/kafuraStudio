/**
 * Decoding audio bytes without destroying them.
 *
 * `BaseAudioContext.decodeAudioData` **detaches** the `ArrayBuffer` it is given. That is
 * specified behaviour, not a browser quirk: the implementation is allowed to take
 * ownership of the bytes, and in practice every current browser hands the buffer straight
 * to its decoder, leaving the caller holding a zero-length detached view.
 *
 * This is not a theoretical hazard here, it was a shipped defect. `attachAudioFile` reads
 * a picked file into one buffer, probes its length with `decodeAudioData`, then puts the
 * same buffer into the media store — and the put threw
 * `DataCloneError: An ArrayBuffer is detached and could not be cloned`. Every automated
 * test passed, because jsdom and the test doubles for `OfflineAudioContext` hand back a
 * stub and never detach anything. The one operation the phase exists to perform failed in
 * the product and nowhere else.
 *
 * So the rule lives here, in one place, and both callers go through it: decode a copy, and
 * the caller's bytes survive. The copy costs one buffer-length allocation, which is the
 * price of the caller's bytes existing at all.
 */

/** Decode `bytes` and leave `bytes` intact. */
export async function decodeAudioDataCopy(
  context: BaseAudioContext,
  bytes: ArrayBuffer,
): Promise<AudioBuffer> {
  return context.decodeAudioData(bytes.slice(0));
}
