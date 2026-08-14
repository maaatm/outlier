import { describe, expect, it } from 'vitest';

import {
  coinsForNewDay,
  duplicateRefund,
  submissionAward,
} from '../src/shared/coins.js';
import {
  BOX_PRICE,
  COINS_FIRST_VOTE,
  COINS_STREAK_BONUS,
  COINS_SUBMISSION,
  COIN_ELIGIBLE_SUBMISSIONS_PER_DAY,
  STREAK_BONUS_EVERY,
} from '../src/shared/config.js';

describe('what a day pays', () => {
  it('pays the flat rate on an ordinary day', () => {
    expect(coinsForNewDay(1)).toBe(COINS_FIRST_VOTE);
    expect(coinsForNewDay(6)).toBe(COINS_FIRST_VOTE);
    expect(coinsForNewDay(8)).toBe(COINS_FIRST_VOTE);
  });

  it('adds the bonus on every seventh day', () => {
    for (const streak of [7, 14, 21, 70]) {
      expect(coinsForNewDay(streak)).toBe(COINS_FIRST_VOTE + COINS_STREAK_BONUS);
    }
  });

  it('does not pay a bonus at zero, which is not a seventh day', () => {
    // Unreachable from `advance`, which never sets a streak of 0 on a day it
    // counted — but `0 % 7 === 0` is exactly the trap worth nailing down.
    expect(coinsForNewDay(0)).toBe(COINS_FIRST_VOTE);
  });

  it('pays a bonus only on multiples of the configured interval', () => {
    for (let streak = 1; streak <= 30; streak++) {
      const bonus = coinsForNewDay(streak) - COINS_FIRST_VOTE;
      expect(bonus).toBe(streak % STREAK_BONUS_EVERY === 0 ? COINS_STREAK_BONUS : 0);
    }
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
