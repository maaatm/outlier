/**
 * The most-misjudged leaderboard.
 *
 * This is the feedback loop from the spec: it teaches the subreddit what a good
 * question looks like far better than a rules page does. A question scores high
 * here when players consistently failed to predict its split.
 */

import { redis } from '@devvit/web/server';

import { LEADERBOARD_MIN_VOTES, LEADERBOARD_SIZE } from '../../shared/config.js';
import type { MisjudgedEntry } from '../../shared/types.js';
import { keys, voteFields } from './keys.js';
import { getQuestion } from './questions.js';

/**
 * Questions ranked by average guessing error, worst first.
 *
 * The zset is scanned a page at a time rather than read whole: entries below
 * the vote floor are dropped, so the number of rows needed is not known up
 * front, but the walk still stops as soon as the page is full.
 */
export async function misjudgedLeaderboard(
  limit: number = LEADERBOARD_SIZE
): Promise<MisjudgedEntry[]> {
  const entries: MisjudgedEntry[] = [];
  const page = Math.max(limit * 3, 30);

  const ranked = await redis.zRange(keys.misjudged, 0, page - 1, {
    by: 'rank',
    reverse: true,
  });

  for (const { member, score } of ranked) {
    if (entries.length >= limit) break;

    const question = await getQuestion(member);
    if (!question) {
      await redis.zRem(keys.misjudged, [member]);
      continue;
    }

    const votes = Number((await redis.hGet(keys.votes(member), voteFields.guessCount)) ?? 0) || 0;
    if (votes < LEADERBOARD_MIN_VOTES) continue;

    entries.push({
      id: question.id,
      text: question.text,
      avgError: Math.round(score * 10) / 10,
      votes,
      source: question.source,
    });
  }

  return entries;
}

/** The leaderboard as a post body, for the recurring event post. */
export function renderLeaderboardPost(entries: MisjudgedEntry[]): string {
  if (entries.length === 0) {
    return [
      'No question has enough votes to rank yet.',
      '',
      `A question needs ${LEADERBOARD_MIN_VOTES} votes before it appears here.`,
    ].join('\n');
  }

  const lines = [
    'The questions this subreddit read worst. Average error is how far the typical',
    'guess landed from the real split.',
    '',
    '| # | Question | Avg error | Votes |',
    '|---|---|---|---|',
  ];

  entries.forEach((entry, index) => {
    lines.push(
      `| ${index + 1} | ${entry.text.replace(/\|/g, '\\|')} | ${entry.avgError.toFixed(1)} | ${entry.votes} |`
    );
  });

  lines.push('', 'A high number here is a compliment to the question, not to anyone who missed it.');
  return lines.join('\n');
}
