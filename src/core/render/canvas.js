/**
 * A minimal structural view of the Canvas 2D API.
 *
 * Declaring it here rather than using the DOM's `CanvasRenderingContext2D` keeps
 * `src/core` free of DOM types (AGENTS.md RULE 5) and is what lets the render
 * function be driven by a recording stub in unit tests — no browser, no GPU.
 *
 * The browser's real context satisfies this interface structurally.
 */
export {};
