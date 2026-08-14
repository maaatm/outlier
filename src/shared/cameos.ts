/**
 * Which of the recent voters get a blob in the crowd. Pure, so the one decision
 * with an opinion in it can be argued with in a test.
 *
 * ## The honesty problem, and the side taken
 *
 * `recent:{questionId}` holds the last `RECENT_VOTER_CAP` voters and the reveal
 * draws `CAMEO_COUNT` of them. Taking the newest ten would be cheaper and would
 * lie: the last ten people to answer are not a sample of the crowd, so on a
 * question sitting at 50/50 a run of "yes" answers puts every cameo in one camp
 * and the crowd tells a small untruth about itself.
 *
 * So the ten are drawn across the whole window instead, by a seeded shuffle
 * that costs nothing. Be clear about what that fixes: the recency skew *inside*
 * the window, and nothing else. The window is still the last thirty voters
 * rather than the ten thousand before them, so these are people who answered,
 * not a sample of the people who answered — which is why nothing on the reveal
 * describes them as one. The copy names them; it never counts them.
 *
 * The seed is the question, not the clock. A reveal reopened an hour later
 * shows the same faces in the same camps rather than reshuffling the crowd
 * under the reader.
 */

import { makeRandom } from './rng.js';

/**
 * `count` ids drawn from across `ids`, the same way every time for a seed.
 *
 * A partial Fisher-Yates: only the first `count` positions have to be settled,
 * so a window of thirty is not shuffled to pick ten from it.
 */
export function sampleCameos(ids: readonly string[], count: number, seed: number): string[] {
  if (count <= 0) return [];
  // Nothing to choose. Returning the window as it stands is not a sample and is
  // not pretending to be one — every eligible voter is on screen.
  if (ids.length <= count) return [...ids];

  const random = makeRandom(seed);
  const pool = [...ids];

  for (let index = 0; index < count; index++) {
    const pick = index + Math.floor(random() * (pool.length - index));
    const held = pool[index]!;
    pool[index] = pool[pick]!;
    pool[pick] = held;
  }

  return pool.slice(0, count);
}
