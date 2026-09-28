/**
 * Vitest setup.
 *
 * `environment: 'jsdom'` is set in vitest.config.ts, so this file needs the Testing
 * Library matchers. Core tests do not need the DOM at all — they pass a recording
 * context to `renderScene` — but the config is shared.
 */

import '@testing-library/jest-dom/vitest';

/**
 * jsdom does not implement `PointerEvent`.
 *
 * Testing Library's `fireEvent.pointerDown` then produces an event with every
 * coordinate `undefined`, so any component that measures the pointer gets `NaN` and
 * the test fails with no hint why. It affects anything pointer-driven — the
 * timeline's drag and scrub included.
 *
 * `PointerEvent` extends `MouseEvent`, and jsdom's `MouseEvent` handles coordinates
 * correctly, so aliasing one to the other is sufficient and adds no behaviour of its
 * own to be wrong about. Guarded rather than assumed, so a future jsdom that does
 * implement it properly is left alone.
 */
const nativeIsUsable = ((): boolean => {
  if (typeof PointerEvent !== 'function') return false;
  try {
    return new PointerEvent('pointerdown', { clientX: 1, clientY: 1 }).clientX === 1;
  } catch {
    return false;
  }
})();

if (!nativeIsUsable) {
  class PointerEventPolyfill extends MouseEvent {}
  for (const target of [window, globalThis]) {
    Object.defineProperty(target, 'PointerEvent', {
      value: PointerEventPolyfill,
      writable: true,
      configurable: true,
    });
  }
}
