import { describe, expect, it } from 'vitest';

import { sampleCameos } from '../src/shared/cameos.js';
import { CAMEO_COUNT, RECENT_VOTER_CAP } from '../src/shared/config.js';
import { seedFrom } from '../src/shared/rng.js';

const window = Array.from({ length: RECENT_VOTER_CAP }, (_, index) => `t2_${index}`);

describe('choosing the cameos', () => {
  it('draws the asked-for number when the window has more', () => {
    expect(sampleCameos(window, CAMEO_COUNT, 1)).toHaveLength(CAMEO_COUNT);
  });

  it('never draws the same person twice', () => {
    const drawn = sampleCameos(window, CAMEO_COUNT, 99);
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it('draws only from the window it was given', () => {
    for (const id of sampleCameos(window, CAMEO_COUNT, 7)) {
      expect(window).toContain(id);
    }
  });

  it('takes everybody when there are fewer than it wants', () => {
    const few = window.slice(0, 4);
    expect(sampleCameos(few, CAMEO_COUNT, 3)).toEqual(few);
  });

  it('handles a window with nobody in it', () => {
    expect(sampleCameos([], CAMEO_COUNT, 3)).toEqual([]);
    expect(sampleCameos(window, 0, 3)).toEqual([]);
  });

  it('leaves the window it was handed alone', () => {
    const before = [...window];
    sampleCameos(window, CAMEO_COUNT, 11);
    expect(window).toEqual(before);
  });

  /*
   * The point of the whole module. Reopening a reveal must show the same faces
   * in the same order — a crowd that reshuffles itself while the reader is
   * looking at it is a crowd that was never telling them anything.
   */
  it('draws the same people every time for a seed', () => {
    const seed = seedFrom('h042');
    expect(sampleCameos(window, CAMEO_COUNT, seed)).toEqual(
      sampleCameos(window, CAMEO_COUNT, seed)
    );
  });

  it('draws different people for different questions', () => {
    const one = sampleCameos(window, CAMEO_COUNT, seedFrom('h042'));
    const two = sampleCameos(window, CAMEO_COUNT, seedFrom('h043'));
    expect(one).not.toEqual(two);
  });

  /*
   * The honesty test, and the reason this is a sample rather than a slice.
   *
   * The window is in vote order, so taking the newest ten would only ever
   * return the last ten entries — and on a question whose recent voters all
   * said the same thing, every cameo would sit in one camp. Drawing across the
   * window cannot fix a skew in the window itself, but it does stop the code
   * from adding one of its own. Across many seeds every position in the window
   * should turn up, and the newest ten should not be over-represented.
   */
  it('draws from across the window rather than off the end of it', () => {
    const seen = new Set<number>();
    let fromNewestTen = 0;
    let drawn = 0;

    for (let seed = 0; seed < 200; seed++) {
      for (const id of sampleCameos(window, CAMEO_COUNT, seed)) {
        const at = window.indexOf(id);
        seen.add(at);
        if (at >= RECENT_VOTER_CAP - CAMEO_COUNT) fromNewestTen++;
        drawn++;
      }
    }

    expect(seen.size).toBe(RECENT_VOTER_CAP);
    // A third of the window is the newest ten, so a third of the draws should
    // be. A slice off the end would score 1.
    expect(fromNewestTen / drawn).toBeGreaterThan(0.25);
    expect(fromNewestTen / drawn).toBeLessThan(0.42);
  });
});

describe('seeding from a question id', () => {
  it('gives the same seed for the same id', () => {
    expect(seedFrom('h042')).toBe(seedFrom('h042'));
  });

  it('gives different seeds for ids a character apart', () => {
    expect(seedFrom('h042')).not.toBe(seedFrom('h043'));
    expect(seedFrom('open_abc')).not.toBe(seedFrom('open_abd'));
  });

  it('stays inside the unsigned 32-bit range mulberry32 wants', () => {
    for (const id of ['', 'h001', 'open_1712345678_ab12cd', '🙂']) {
      const seed = seedFrom(id);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
