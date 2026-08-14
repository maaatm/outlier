/**
 * The players in the crowd.
 *
 * A cameo publishes how somebody voted. Until now, how you answered was yours:
 * the only way it became public was if you tapped share on the third reveal
 * slide and posted the comment yourself. So this file has one job beyond
 * fetching, and it is the important one — nothing leaves here about a player
 * who has not, at minimum, left the setting alone.
 *
 * Three rules, and the shape of the code is what enforces them:
 *
 *  1. **Only voters, ever.** The candidates come from `recent:{questionId}`,
 *     which is written by `castVote` and by nothing else. A signed-out reader
 *     and a player who has never answered cannot be in it, so their exclusion is
 *     structural rather than a check somebody has to remember to write.
 *  2. **Only the opted-in.** `showBlob` is read here, now, on every reveal —
 *     never captured at vote time. Switching it off therefore removes a player
 *     from crowds they are already in, including questions they answered months
 *     ago, because there is nowhere for the old answer to be cached.
 *  3. **Only to somebody who already knows.** This is reached from
 *     `buildReveal` and from nowhere else, so it is behind the same
 *     `voted:{questionId}` gate the tally is behind. A reader who has not voted
 *     cannot get here, and there is no route that returns a `Cameo` on its own.
 *
 * The viewer is dropped from their own crowd. Their dot is already the focal
 * point of the screen and a second version of themselves standing in the pack
 * would be a puzzle rather than a cameo.
 *
 * ## The cost
 *
 * One `zRange`, then a single parallel wave: the votes, the avatars and the
 * names of the candidates, plus one read each for the preference. Two round
 * trips deep, and the whole thing hangs off the `Promise.all` `buildReveal` was
 * already waiting on, so the reveal gains no serial step. The avatars come back
 * in one `hMGet` because prompt 03 packed the equipped pair into a single field
 * of a single shared hash for exactly this screen.
 */

import { redis } from '@devvit/web/server';

import { sampleCameos } from '../../shared/cameos.js';
import { CAMEO_COUNT, RECENT_VOTER_CAP } from '../../shared/config.js';
import { unpackAvatar } from '../../shared/items.js';
import { seedFrom } from '../../shared/rng.js';
import type { Cameo } from '../../shared/types.js';
import { decodeVote } from '../../shared/vote.js';
import { readShowBlobFor } from './avatars.js';
import { keys } from './keys.js';

/**
 * Up to `CAMEO_COUNT` other players who answered this question.
 *
 * Fewer than that is normal and not a failure: a question nobody else has
 * answered returns none, and so does one whose recent voters have all opted
 * out. The reveal renders the same either way.
 */
export async function readCameos(questionId: string, viewerId: string): Promise<Cameo[]> {
  // The newest `RECENT_VOTER_CAP`, which is the whole key — the write path trims
  // it to exactly that. Asking for them by rank from the top rather than for all
  // of them means lowering the cap later reads the newest voters rather than the
  // oldest ones left behind by the old trim.
  const window = await redis.zRange(keys.recent(questionId), 0, RECENT_VOTER_CAP - 1, {
    by: 'rank',
    reverse: true,
  });

  const candidates = sampleCameos(
    window.map((entry) => entry.member).filter((userId) => userId !== viewerId),
    CAMEO_COUNT,
    seedFrom(questionId)
  );
  // Nothing to ask about. Worth the branch: `hMGet` with no fields is a round
  // trip spent on an empty answer, and an unanswered question is the common
  // case for anything that is not the Daily.
  if (candidates.length === 0) return [];

  const [votes, avatars, names, visible] = await Promise.all([
    redis.hMGet(keys.voted(questionId), candidates),
    redis.hMGet(keys.avatars, candidates),
    redis.hMGet(keys.names, candidates),
    readShowBlobFor(candidates),
  ]);

  const cameos: Cameo[] = [];
  for (let index = 0; index < candidates.length; index++) {
    // The one filter, in the one place. Everything past it has been decided to
    // be showable; nothing stopped by it reaches a response.
    if (!visible[index]) continue;

    const vote = decodeVote(votes[index]);
    const name = names[index];
    // A candidate with no decodable vote is a row `castVote` never finished
    // writing; one with no name banked a vote before names were stored. Both
    // are drawn as nobody — a blob with no side has nowhere to stand, and a
    // blob with no name is decoration.
    if (!vote || !name) continue;

    cameos.push({ name, choice: vote.choice, avatar: unpackAvatar(avatars[index]) });
  }

  return cameos;
}
