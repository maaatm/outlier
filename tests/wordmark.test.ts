/**
 * The wordmark's numbers, against the reference.
 *
 * `docs/design_handoff_wordmark/` documents the lockup at exactly two sizes and
 * gives every measurement for both. The component derives them from one ratio
 * each, which is the only way the two stay the same mark — so what is worth
 * pinning down is that the ratios still land on the documented numbers, and
 * that nothing between them comes out degenerate.
 */

import { describe, expect, it } from 'vitest';

import {
  WORDMARK_MIN_SIZE,
  WORDMARK_SIZE,
  wordmarkGeometry,
} from '../src/client/wordmarkArt.js';

describe('the lockup at the two documented sizes', () => {
  it('is the reference at 58, the menu', () => {
    expect(wordmarkGeometry(58)).toEqual({
      disc: 46,
      overlap: -3,
      depth: 7,
      mould: 4,
      shadowY: 13,
      shadowBlur: 16,
    });
  });

  it('is the reference at 22, the header', () => {
    expect(wordmarkGeometry(22)).toEqual({
      disc: 17,
      overlap: -1,
      depth: 3,
      mould: 2,
      shadowY: 5,
      shadowBlur: 7,
    });
  });

  it('is what the app actually asks for', () => {
    expect(WORDMARK_SIZE.menu).toBe(58);
    expect(WORDMARK_SIZE.header).toBe(22);
  });
});

describe('the lockup at every other size', () => {
  /*
   * The stylesheet steps the size in three media queries — 72 on a desktop, 40
   * and 32 on short screens — so the sizes the component is handed are not the
   * only ones it renders at, and every one of them has to produce a piece
   * rather than a smudge.
   */
  const sizes = Array.from({ length: 120 - WORDMARK_MIN_SIZE + 1 }, (_, i) => i + WORDMARK_MIN_SIZE);

  it('never lets the bottom face thin out below 3px', () => {
    for (const size of sizes) expect(wordmarkGeometry(size).depth).toBeGreaterThanOrEqual(3);
  });

  it('never loses the moulded edge, the disc, or either shadow', () => {
    for (const size of sizes) {
      const g = wordmarkGeometry(size);
      expect(g.mould).toBeGreaterThanOrEqual(1);
      expect(g.disc).toBeGreaterThan(0);
      expect(g.shadowY).toBeGreaterThan(0);
      expect(g.shadowBlur).toBeGreaterThan(0);
    }
  });

  it('always pulls the disc onto the U rather than away from it', () => {
    for (const size of sizes) expect(wordmarkGeometry(size).overlap).toBeLessThan(0);
  });

  it('grows with the size and never shrinks', () => {
    for (let i = 1; i < sizes.length; i++) {
      const smaller = wordmarkGeometry(sizes[i - 1]!);
      const bigger = wordmarkGeometry(sizes[i]!);
      expect(bigger.disc).toBeGreaterThanOrEqual(smaller.disc);
      expect(bigger.depth).toBeGreaterThanOrEqual(smaller.depth);
      expect(bigger.shadowBlur).toBeGreaterThanOrEqual(smaller.shadowBlur);
    }
  });
});

describe('the floor the fallback hangs off', () => {
  /*
   * The eyes are 18% of a disc that is 79% of the size. At the floor that is
   * 2.5px across, which is the last size at which two dots read as a face
   * rather than as noise on a circle — and the header, the smallest place the
   * lockup is used, sits comfortably above it.
   */
  it('is 18, and the header clears it', () => {
    expect(WORDMARK_MIN_SIZE).toBe(18);
    expect(WORDMARK_SIZE.header).toBeGreaterThanOrEqual(WORDMARK_MIN_SIZE);
  });

  it('still leaves an eye wide enough to see at the floor', () => {
    const eye = wordmarkGeometry(WORDMARK_MIN_SIZE).disc * 0.18;
    expect(eye).toBeGreaterThan(2);
  });
});
