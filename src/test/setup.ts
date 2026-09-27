/**
 * Vitest setup.
 *
 * `environment: 'jsdom'` is set in vitest.config.ts, so this file only needs to
 * register the Testing Library matchers. Core tests do not need the DOM at all —
 * they pass a recording context to `renderScene` — but the config is shared.
 */

import '@testing-library/jest-dom/vitest';
