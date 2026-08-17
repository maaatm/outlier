import { describe, expect, it } from 'vitest';

import {
  coinsForNewDay,
  commentIsSettled,
  commentUpvoteDue,
  commentUpvoteOwed,
  duplicateRefund,
  royaltyFor,
  submissionAward,
} from '../src/shared/coins.js';
import {
  BOX_PRICE,
  COINS_FIRST_VOTE,
  COINS_PER_COMMENT_UPVOTE,
  COINS_STREAK_BONUS,
  COINS_SUBMISSION,
  COIN_ELIGIBLE_SUBMISSIONS_PER_DAY,
  COMMENT_UPVOTE_COIN_CAP,
  ROYALTY_COIN_CAP,
  ROYALTY_VOTES_PER_COIN,
  STREAK_BONUS_EVERY,
} from '../src/shared/config.js';

/*
 * The two halves are reported apart because the ledger says where a coin came
 * from, and "turned up today" and "7 days in a row" are two different answers.
 * What the day pays is still the sum, and these say so on both sides.
 */
const paid = (streak: number): number => {
  const award = coinsForNewDay(streak);
  return award.daily + award.streak;
};

describe('what a day pays', () => {
  it('pays the flat rate on an ordinary day', () => {
    expect(paid(1)).toBe(COINS_FIRST_VOTE);
    expect(paid(6)).toBe(COINS_FIRST_VOTE);
    expect(paid(8)).toBe(COINS_FIRST_VOTE);
  });

  it('adds the bonus on every seventh day', () => {
    for (const streak of [7, 14, 21, 70]) {
      expect(paid(streak)).toBe(COINS_FIRST_VOTE + COINS_STREAK_BONUS);
    }
  });

  it('does not pay a bonus at zero, which is not a seventh day', () => {
    // Unreachable from `advance`, which never sets a streak of 0 on a day it
    // counted — but `0 % 7 === 0` is exactly the trap worth nailing down.
    expect(paid(0)).toBe(COINS_FIRST_VOTE);
  });

  it('pays a bonus only on multiples of the configured interval', () => {
    for (let streak = 1; streak <= 30; streak++) {
      const bonus = paid(streak) - COINS_FIRST_VOTE;
      expect(bonus).toBe(streak % STREAK_BONUS_EVERY === 0 ? COINS_STREAK_BONUS : 0);
    }
  });

  it('keeps the two halves apart, so the ledger can name them', () => {
    // Turning up is paid on every day, whatever the streak does. Only the
    // second half moves.
    expect(coinsForNewDay(6)).toEqual({ daily: COINS_FIRST_VOTE, streak: 0 });
    expect(coinsForNewDay(7)).toEqual({
      daily: COINS_FIRST_VOTE,
      streak: COINS_STREAK_BONUS,
    });
  });
});

/*
 * The eligibility cap is off by default. These prove both sides of it: that
 * turning it on is a config change rather than a code change, and that with it
 * off nothing is capped.
 */
describe('what a submission pays', () => {
  it('pays every submission while the cap is disabled', () => {
    expect(COIN_ELIGIBLE_SUBMISSIONS_PER_DAY).toBe(Infinity);

    let state = { subDay: '', subCount: 0 };
    for (let i = 1; i <= 50; i++) {
      const award = submissionAward(state.subDay, state.subCount, '2026-04-01');
      expect(award.coins).toBe(COINS_SUBMISSION);
      expect(award.subCount).toBe(i);
      state = award;
    }
  });

  it('stops paying past a finite cap, without refusing the submission', () => {
    let state = { subDay: '', subCount: 0 };
    const paid: number[] = [];

    for (let i = 0; i < 5; i++) {
      const award = submissionAward(state.subDay, state.subCount, '2026-04-01', 3);
      paid.push(award.coins);
      state = award;
    }

    expect(paid).toEqual([COINS_SUBMISSION, COINS_SUBMISSION, COINS_SUBMISSION, 0, 0]);
    // The count keeps climbing even once it stops paying: the cap is on the
    // reward, and nothing here has an opinion about the post.
    expect(state.subCount).toBe(5);
  });

  it('resets when the UTC day turns over', () => {
    const monday = submissionAward('2026-04-01', 3, '2026-04-02', 3);
    expect(monday.subDay).toBe('2026-04-02');
    expect(monday.subCount).toBe(1);
    expect(monday.coins).toBe(COINS_SUBMISSION);
  });

  it('treats a record with no day on it as a day that has turned', () => {
    const award = submissionAward('', 99, '2026-04-02', 3);
    expect(award.subCount).toBe(1);
    expect(award.coins).toBe(COINS_SUBMISSION);
  });
});

/*
 * A comment's upvotes. The rule is a total owed rather than an increment, so
 * that a caller can pay the difference from a watermark and a missed sweep
 * costs latency rather than coins.
 */
describe('what a comment’s upvotes pay', () => {
  it('owes nothing for the automatic upvote a comment is born with', () => {
    // Reddit scores a new comment 1, and that one is the author's own.
    expect(commentUpvoteOwed(0)).toBe(0);
    expect(commentUpvoteOwed(1)).toBe(0);
  });

  it('pays for every upvote past that one', () => {
    expect(commentUpvoteOwed(2)).toBe(COINS_PER_COMMENT_UPVOTE);
    expect(commentUpvoteOwed(5)).toBe(4 * COINS_PER_COMMENT_UPVOTE);
  });

  it('holds at the cap however far a comment runs', () => {
    expect(commentUpvoteOwed(200)).toBe(COMMENT_UPVOTE_COIN_CAP);
    expect(commentUpvoteOwed(20_000)).toBe(COMMENT_UPVOTE_COIN_CAP);
  });

  it('owes nothing on a comment voted below zero', () => {
    expect(commentUpvoteOwed(-40)).toBe(0);
  });

  it('never takes anything back when a comment falls after payment', () => {
    // Paid 8, then downvoted to nothing. There is no claw-back: the player did
    // not do anything, and coins already banked stay banked.
    expect(commentUpvoteDue(-5, 8)).toBe(0);
    expect(commentUpvoteDue(2, 8)).toBe(0);
  });

  it('pays only the difference from what has already been paid', () => {
    expect(commentUpvoteDue(6, 0)).toBe(5 * COINS_PER_COMMENT_UPVOTE);
    expect(commentUpvoteDue(6, 3)).toBe(5 * COINS_PER_COMMENT_UPVOTE - 3);
    // Paying twice for the same score is what the watermark exists to prevent.
    expect(commentUpvoteDue(6, 5 * COINS_PER_COMMENT_UPVOTE)).toBe(0);
  });

  it('calls a comment settled once it has been paid the cap', () => {
    expect(commentIsSettled(COMMENT_UPVOTE_COIN_CAP - 1)).toBe(false);
    expect(commentIsSettled(COMMENT_UPVOTE_COIN_CAP)).toBe(true);
  });
});

/*
 * The royalty is keyed on the count a vote produced rather than on a running
 * total, which is what makes it exact without a watermark: exactly one vote in
 * a question's life ever sees each multiple of a hundred.
 */
describe('what a question pays its author', () => {
  it('pays on the hundredth answer and on no other', () => {
    expect(royaltyFor(ROYALTY_VOTES_PER_COIN - 1)).toBe(0);
    expect(royaltyFor(ROYALTY_VOTES_PER_COIN)).toBe(1);
    expect(royaltyFor(ROYALTY_VOTES_PER_COIN + 1)).toBe(0);
  });

  it('pays exactly once per hundred, across a question’s whole life', () => {
    let total = 0;
    for (let count = 1; count <= 1000; count++) total += royaltyFor(count);
    expect(total).toBe(1000 / ROYALTY_VOTES_PER_COIN);
  });

  it('stops at the cap and never starts again', () => {
    const last = ROYALTY_VOTES_PER_COIN * ROYALTY_COIN_CAP;
    expect(royaltyFor(last)).toBe(1);
    expect(royaltyFor(last + ROYALTY_VOTES_PER_COIN)).toBe(0);
    expect(royaltyFor(last * 10)).toBe(0);
  });

  it('pays nothing for a question nobody has answered', () => {
    // `0 % 100 === 0`, the same trap `coinsForNewDay` guards at zero.
    expect(royaltyFor(0)).toBe(0);
  });
});

describe('the duplicate refund', () => {
  it('pays back a fraction of the price, in whole coins', () => {
    const refund = duplicateRefund();
    expect(Number.isInteger(refund)).toBe(true);
    expect(refund).toBeGreaterThan(0);
    expect(refund).toBeLessThan(BOX_PRICE);
  });

  it('scales with the price it is given', () => {
    expect(duplicateRefund(100)).toBeGreaterThan(duplicateRefund(50));
  });
});
