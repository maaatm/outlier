/**
 * The Daily: resolution, posting, and the next day's summary.
 *
 * Source order is fixed by the spec — a promoted community question first, the
 * house pool second. The house pool exists so the game survives with zero
 * community input, so it is never skipped when promotion finds nothing.
 */

import { context, redis, reddit } from '@devvit/web/server';
import type { T3 } from '@devvit/web/shared';

import { COINS_PROMOTION, DAILY_FLAIR, PROVISIONAL_VOTE_FLOOR } from '../../shared/config.js';
import { previousDay, toDayKey } from '../../shared/day.js';
import { percentAgreeing } from '../../shared/scoring.js';
import { fitTitle } from '../../shared/validate.js';
import { creditCoins } from './coins.js';
import { logEarning } from './earnings.js';
import { keys } from './keys.js';
import { questionAtCursor, poolSize } from './pool.js';
import { getQuestion, linkQuestionToPost, markAsDaily, writeQuestion } from './questions.js';
import { nextPromotable, retire } from './queue.js';
import { readTally } from './votes.js';

export type DailyResolution = {
  questionId: string;
  /**
   * Set when a community question took the slot: the credit line reads the
   * name, and the promotion award pays the id.
   *
   * The id comes off the `q:{id}` record rather than from resolving the name
   * back through Reddit — the record already has it, and a display name is not
   * an identity. Either half may be empty: a house question has neither, and a
   * community question whose author lookup failed at submission has a payable
   * id and nothing to credit.
   */
  promotedFrom?: { authorName: string; authorId: string };
};

/** Advance the house cursor and materialise the question record it points at. */
async function drawFromHousePool(): Promise<string> {
  const cursor = Number((await redis.get(keys.poolCursor)) ?? 0) || 0;
  const draw = questionAtCursor(cursor);
  await redis.set(keys.poolCursor, String(cursor + 1));

  // House questions are written on first use so their id is stable across the
  // whole pass and re-drawing on a later lap reuses the same record.
  const existing = await getQuestion(draw.id);
  if (!existing) {
    await writeQuestion({
      id: draw.id,
      text: draw.text,
      // Nobody titled these. A house question reaches the subreddit through
      // `dailyTitle`, which builds its own from the day and the text.
      title: '',
      labelA: draw.labelA ?? 'Yes',
      labelB: draw.labelB ?? 'No',
      authorId: '',
      authorName: '',
      source: 'house',
    });
  }
  return draw.id;
}

/** Promoted community question, else the house pool. */
export async function resolveDailyQuestion(): Promise<DailyResolution> {
  const promoted = await nextPromotable();
  if (promoted) {
    const question = await getQuestion(promoted);
    if (question) {
      await retire(promoted);
      const resolution: DailyResolution = { questionId: promoted };
      if (question.authorName || question.authorId) {
        resolution.promotedFrom = {
          authorName: question.authorName,
          authorId: question.authorId,
        };
      }
      return resolution;
    }
  }
  return { questionId: await drawFromHousePool() };
}

function dailyTitle(day: string, text: string): string {
  // Player questions have no length rule any more, so a promoted one can be
  // longer than Reddit will take once the day and the prefix are on the front of
  // it. Trimmed rather than refused — the same call `normalizeTitle` makes, and
  // by the same function, so there is one answer to "too long for Reddit".
  return fitTitle(`Daily · ${day} · ${text}`);
}

export type PostDailyResult =
  | {
      status: 'created';
      day: string;
      questionId: string;
      postId: string;
      /** Empty on a house question. The author who is about to be told, and skipped in the broadcast. */
      promotedAuthorId: string;
      /** The question itself, so the task does not re-read the record to write a sentence. */
      questionText: string;
    }
  | { status: 'exists'; day: string; questionId: string };

/**
 * Create the Daily post for a day.
 *
 * Guarded against double-firing: if `daily:{day}` already holds a question, the
 * job returns without creating anything. The key is claimed with `nx` before
 * the post is created, so two overlapping runs cannot both get through.
 */
export async function postDaily(day: string = toDayKey()): Promise<PostDailyResult> {
  const existing = await redis.get(keys.daily(day));
  if (existing) return { status: 'exists', day, questionId: existing };

  // `hSetNX` reports whether *this* call won, unambiguously. The claim comes
  // before the question is resolved so a losing run never burns a house draw.
  const claimed = await redis.hSetNX(keys.dailyClaims, day, '1');
  if (claimed === 0) {
    return { status: 'exists', day, questionId: (await redis.get(keys.daily(day))) ?? '' };
  }

  try {
    const resolution = await resolveDailyQuestion();

    const question = await getQuestion(resolution.questionId);
    if (!question) throw new Error(`daily ${day} resolved to a missing question`);

    const credit = resolution.promotedFrom?.authorName
      ? `Today's question comes from u/${resolution.promotedFrom.authorName}.`
      : '';

    const post = await reddit.submitCustomPost({
      subredditName: await currentSubredditName(),
      title: dailyTitle(day, question.text),
      flairText: DAILY_FLAIR,
      textFallback: {
        text: [
          question.text,
          '',
          'Answer, then guess what percentage of people agreed with you.',
          credit,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    });

    await Promise.all([
      redis.set(keys.daily(day), resolution.questionId),
      markAsDaily(resolution.questionId, day),
      linkQuestionToPost(resolution.questionId, post.id, post.permalink),
    ]);

    /*
     * The promotion award pays the author, not the moderator who approved it and
     * not whoever ran the job.
     *
     * It sits inside the `daily:claims` guard, which is what makes it pay once:
     * a re-run of `post-daily` for this day never reaches here, because either
     * `daily:{day}` is already set or the claim is already taken. A house
     * question has no `promotedFrom`, so nobody is paid and nothing errors.
     *
     * If the credit itself throws, the catch below releases the claim — but
     * `daily:{day}` is set by now, so the next run returns `exists` and the
     * author goes unpaid rather than being paid twice. That is the direction
     * worth failing in.
     */
    const promotedAuthor = resolution.promotedFrom?.authorId ?? '';
    await creditCoins(promotedAuthor, COINS_PROMOTION);
    // The receipt, on the one earn the author is not present for: their question
    // was chosen while they were somewhere else. `logEarning` ignores an empty
    // id the same way `creditCoins` does, so a house Daily records nothing.
    await logEarning(promotedAuthor, 'promotion', COINS_PROMOTION);

    return {
      status: 'created',
      day,
      questionId: resolution.questionId,
      postId: post.id,
      promotedAuthorId: promotedAuthor,
      questionText: question.text,
    };
  } catch (error) {
    // Release the claim, or the subreddit gets no Daily at all today.
    await redis.hDel(keys.dailyClaims, [day]);
    throw error;
  }
}

export type SummarizeDailyResult =
  | { status: 'summarized'; day: string; questionId: string }
  | { status: 'skipped'; day: string; reason: string };

/**
 * Sticky a summary of the previous day's Daily. Voting stays open.
 *
 * Yesterday's question is not finished with — it counts toward a streak and pays
 * points exactly like today's, so closing it would make the archive unplayable
 * and would quietly cost somebody a streak for answering the wrong question. The
 * summary therefore reports where the split stands rather than declaring a
 * result, and it is expected to go stale.
 *
 * `daily:summaries` is the double-post guard, claimed before the comment is
 * submitted for the same reason `daily:claims` is claimed before the question is
 * resolved: two overlapping runs must leave one sticky, not two.
 */
export async function summarizeDaily(
  day: string = previousDay()
): Promise<SummarizeDailyResult> {
  const questionId = await redis.get(keys.daily(day));
  if (!questionId) return { status: 'skipped', day, reason: 'no daily for that day' };

  const question = await getQuestion(questionId);
  if (!question) return { status: 'skipped', day, reason: 'question record missing' };
  if (!question.postId) return { status: 'skipped', day, reason: 'daily has no post' };

  const claimed = await redis.hSetNX(keys.dailySummaries, day, '1');
  if (claimed === 0) return { status: 'skipped', day, reason: 'already summarized' };

  try {
    const tally = await readTally(questionId);
    const summary = buildDailySummary(question.text, question.labelA, question.labelB, tally);
    const comment = await reddit.submitComment({ id: question.postId as T3, text: summary });
    await comment.distinguish(true);
  } catch (error) {
    // Release the claim and let the next run try again. A missing summary is
    // recoverable; a duplicate sticky is not.
    await redis.hDel(keys.dailySummaries, [day]);
    console.error(`summarize-daily: could not sticky the summary for ${questionId}`, error);
    return { status: 'skipped', day, reason: 'comment failed' };
  }

  return { status: 'summarized', day, questionId };
}

/**
 * The sticky itself. Everything it says is true at the moment it is posted and
 * may not be an hour later, so it never claims to be the last word.
 */
export function buildDailySummary(
  text: string,
  labelA: string,
  labelB: string,
  tally: { a: number; b: number; total: number }
): string {
  if (tally.total === 0) {
    return [
      `> ${text}`,
      '',
      'Nobody has played this one yet.',
      '',
      '^(Outlier · still open)',
    ].join('\n');
  }

  const percentA = percentAgreeing(tally, 'a');
  const percentB = 100 - percentA;
  const [majorityLabel, majorityPercent] =
    percentA >= percentB ? [labelA, percentA] : [labelB, percentB];
  const [minorityLabel, minorityPercent] =
    percentA >= percentB ? [labelB, percentB] : [labelA, percentA];

  const lines = [
    `> ${text}`,
    '',
    `**${majorityLabel} ${majorityPercent}%** · ${minorityLabel} ${minorityPercent}%`,
    '',
    `${tally.total} ${tally.total === 1 ? 'vote' : 'votes'} so far. It is still open, so ` +
      'your own answer moves the split.',
  ];

  if (tally.total < PROVISIONAL_VOTE_FLOOR) {
    lines.push('', 'Still a small crowd, so the split is mostly noise.');
  }

  lines.push('', '^(Outlier · still open)');
  return lines.join('\n');
}

/** The install's subreddit. Comes free with the request context in most paths. */
export async function currentSubredditName(): Promise<string> {
  if (context.subredditName) return context.subredditName;
  const subreddit = await reddit.getCurrentSubreddit();
  return subreddit.name;
}

export async function getDailyQuestionId(day: string = toDayKey()): Promise<string | null> {
  return (await redis.get(keys.daily(day))) ?? null;
}

export { poolSize };
