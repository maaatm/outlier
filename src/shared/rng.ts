/**
 * A seeded pseudo-random generator, shared by everything that needs a draw it
 * can reproduce.
 *
 * Three callers, for different reasons. The house pool shuffles against a fixed
 * seed so every installation draws the same sequence and a restart never
 * re-rolls it. The gift box rolls against `Math.random` in production and
 * against a seed in the tests, which is the only way to assert that the pity
 * guarantee holds over ten thousand boxes rather than over the handful a test
 * could otherwise afford. The reveal's cameos draw against a seed taken from
 * the question, so reopening one shows the same faces rather than reshuffling
 * the crowd under the reader.
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

/**
 * A seed from a string, so a draw can be keyed to the thing it is about rather
 * than to a clock. FNV-1a, and stable across engines for the same reason the
 * generator above is.
 *
 * Collisions are not worth defending against. The one caller keys a shuffle on
 * a question id, and two questions that collided would shuffle the same way —
 * which is not a fact anybody could observe.
 */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
