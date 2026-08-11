import { describe, expect, it } from 'vitest';

import { badgeFor } from '../src/shared/badges.js';
import { HIT_THRESHOLD, MINORITY_THRESHOLD } from '../src/shared/config.js';
import {
  dotsForTally,
  isValidChoice,
  isValidGuess,
  percentAgreeing,
  scoreVote,
} from '../src/shared/scoring.js';
import type { Tally } from '../src/shared/types.js';

const tally = (a: number, b: number): Tally => ({ a, b, total: a + b });

describe('percentAgreeing', () => {
  it('reports the share of the side that was picked', () => {
    expect(percentAgreeing(tally(19, 81), 'a')).toBe(19);
    expect(percentAgreeing(tally(19, 81), 'b')).toBe(81);
  });

  it('returns zero rather than dividing by zero on an empty tally', () => {
    expect(percentAgreeing(tally(0, 0), 'a')).toBe(0);
  });
});

describe('the accuracy axis', () => {
  it('counts an error at exactly the threshold as a hit', () => {
    const score = scoreVote(tally(40, 60), 'a', 40 - HIT_THRESHOLD);
    expect(score.error).toBe(HIT_THRESHOLD);
    expect(score.hit).toBe(true);
  });

  it('counts one point past the threshold as a miss', () => {
    const score = scoreVote(tally(40, 60), 'a', 40 - HIT_THRESHOLD - 1);
    expect(score.hit).toBe(false);
  });
});

describe('the rarity axis', () => {
  it('uses the unrounded share, so 34.6% is still a minority', () => {
    // 173/500 = 34.6%, which rounds up to 35 but must not clear the threshold.
    const score = scoreVote(tally(173, 327), 'a', 35);
    expect(score.actual).toBe(35);
    expect(score.minority).toBe(true);
  });

  it('treats exactly the threshold as majority, not minority', () => {
    const score = scoreVote(tally(35, 65), 'a', 35);
    expect(score.minority).toBe(false);
  });

  it('never calls anyone a minority on an empty tally', () => {
    expect(scoreVote(tally(0, 0), 'a', 50).minority).toBe(false);
  });

  it('matches the configured threshold', () => {
    const justUnder = scoreVote(tally(MINORITY_THRESHOLD - 1, 101 - MINORITY_THRESHOLD), 'a', 0);
    expect(justUnder.minority).toBe(true);
  });
});

describe('the 2x2', () => {
  it('maps each corner to its badge', () => {
    expect(badgeFor(false, true)).toBe('baseline');
    expect(badgeFor(false, false)).toBe('impostor');
    expect(badgeFor(true, true)).toBe('selfAware');
    expect(badgeFor(true, false)).toBe('bubble');
  });

  it('derives the badge from the two axes of the score', () => {
    expect(scoreVote(tally(10, 90), 'a', 10).badge).toBe('selfAware');
    expect(scoreVote(tally(10, 90), 'a', 90).badge).toBe('bubble');
    expect(scoreVote(tally(90, 10), 'a', 90).badge).toBe('baseline');
    expect(scoreVote(tally(90, 10), 'a', 10).badge).toBe('impostor');
  });
});

describe('the dot count', () => {
  it('tracks the rounded percentage so the copy and the crowd agree', () => {
    expect(dotsForTally(tally(19, 81), 'a')).toBe(19);
    expect(dotsForTally(tally(1, 1), 'a')).toBe(50);
  });

  it('keeps a dot for a camp that rounding would erase', () => {
    // 1 in 300 rounds to 0%, but that person is you.
    expect(dotsForTally(tally(1, 299), 'a')).toBe(1);
    expect(dotsForTally(tally(299, 1), 'a')).toBe(99);
  });

  it('allows a wipeout only when a side really is empty', () => {
    expect(dotsForTally(tally(5, 0), 'a')).toBe(100);
    expect(dotsForTally(tally(0, 5), 'a')).toBe(0);
  });
});

describe('input validation', () => {
  it('accepts only whole numbers from 0 to 100', () => {
    expect(isValidGuess(0)).toBe(true);
    expect(isValidGuess(100)).toBe(true);
    expect(isValidGuess(-1)).toBe(false);
    expect(isValidGuess(101)).toBe(false);
    expect(isValidGuess(42.5)).toBe(false);
    expect(isValidGuess('50')).toBe(false);
    expect(isValidGuess(Number.NaN)).toBe(false);
    expect(isValidGuess(null)).toBe(false);
  });

  it('accepts only the two real choices', () => {
    expect(isValidChoice('a')).toBe(true);
    expect(isValidChoice('b')).toBe(true);
    expect(isValidChoice('c')).toBe(false);
    expect(isValidChoice(0)).toBe(false);
  });
});
