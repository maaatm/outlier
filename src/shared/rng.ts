/**
 * A seeded pseudo-random generator, shared by everything that needs a draw it
 * can reproduce.
 *
 * Two callers, for opposite reasons. The house pool shuffles against a fixed
 * seed so every installation draws the same sequence and a restart never
 * re-rolls it. The gift box rolls against `Math.random` in production and
 * against a seed in the tests, which is the only way to assert that the pity
 * guarantee holds over ten thousand boxes rather than over the handful a test
 * could otherwise afford.
 */

/**
 * mulberry32. Small, fast, and stable across engines — which is the point: a
 * generator whose output depends on the JavaScript implementation would make a
 * seeded test an accident of where it ran.
 */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
