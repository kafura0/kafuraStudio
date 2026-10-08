/**
 * `isColorLiteral` — the paintability question.
 *
 * Resolve falls back to treating an unknown colour key as a literal, so the predicate
 * is what separates "a deliberate literal" from "a dangling palette key" for the
 * validator. The interesting cases are the boundary ones: hex lengths, whitespace,
 * case, and the words that look like colour names but are not.
 */

import { describe, expect, it } from 'vitest';
import { isColorLiteral } from './resolve';

describe('isColorLiteral', () => {
  it('accepts every hex length the Canvas accepts, case-insensitively', () => {
    expect(isColorLiteral('#fff')).toBe(true);
    expect(isColorLiteral('#fff8')).toBe(true);
    expect(isColorLiteral('#8d5524')).toBe(true);
    expect(isColorLiteral('#8d5524cc')).toBe(true);
    expect(isColorLiteral('#FFFFFF')).toBe(true);
    expect(isColorLiteral(' #8d5524 ')).toBe(true);
  });

  it('accepts the functional notations', () => {
    expect(isColorLiteral('rgb(1 2 3)')).toBe(true);
    expect(isColorLiteral('rgba(0,0,0,0.5)')).toBe(true);
    expect(isColorLiteral('hsl(120 50% 50%)')).toBe(true);
    expect(isColorLiteral('hsla(120, 50%, 50%, 0.5)')).toBe(true);
    expect(isColorLiteral('hwb(10 0% 20%)')).toBe(true);
    expect(isColorLiteral('lab(50% 20 30)')).toBe(true);
    expect(isColorLiteral('lch(50% 40 200)')).toBe(true);
    expect(isColorLiteral('oklab(0.5 0.1 0.1)')).toBe(true);
    expect(isColorLiteral('oklch(50% 0.2 200)')).toBe(true);
    expect(isColorLiteral('color(srgb 0 0 0)')).toBe(true);
  });

  it('accepts transparent, currentcolor and the named colours, case-insensitively', () => {
    expect(isColorLiteral('transparent')).toBe(true);
    expect(isColorLiteral('currentcolor')).toBe(true);
    expect(isColorLiteral('red')).toBe(true);
    expect(isColorLiteral('rebeccapurple')).toBe(true);
    expect(isColorLiteral('YellowGreen')).toBe(true);
    expect(isColorLiteral('GREY')).toBe(true);
  });

  it('rejects a non-colour word, which is what a dangling palette key looks like', () => {
    expect(isColorLiteral('skinn')).toBe(false);
    expect(isColorLiteral('skin')).toBe(false);
    expect(isColorLiteral('hair')).toBe(false);
    expect(isColorLiteral('top')).toBe(false);
    expect(isColorLiteral('accent')).toBe(false);
  });

  it('rejects malformed colours and the CSS-wide keywords, which paint nothing', () => {
    expect(isColorLiteral('')).toBe(false);
    expect(isColorLiteral('#12345')).toBe(false);
    expect(isColorLiteral('#ggg')).toBe(false);
    expect(isColorLiteral('inherit')).toBe(false);
    expect(isColorLiteral('initial')).toBe(false);
    expect(isColorLiteral('url(#grad)')).toBe(false);
  });
});