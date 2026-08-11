/**
 * Pure scoring. Shared so the client can render a reveal without re-deriving
 * anything, but the server is the only place that ever *computes* one from
 * stored state — the client never sees a tally it has not earned.
 */

import { badgeFor, type BadgeId } from './badges.js';
import { CROWD_SIZE, HIT_THRESHOLD, MINORITY_THRESHOLD } from './config.js';
import type { Choice, Tally } from './types.js';

export type Score = {
  actual: number;
  error: number;
  hit: boolean;
  minority: boolean;
  badge: BadgeId;
  dotsWithYou: number;
};

/** Percent of voters on `choice`, rounded to a whole number. */
export function percentAgreeing(tally: Tally, choice: Choice): number {
  if (tally.total <= 0) return 0;
  const mine = choice === 'a' ? tally.a : tally.b;
  return Math.round((mine / tally.total) * 100);
}

/**
 * The share used for the minority test is the unrounded one. Rounding first
 * would put a 34.6% side on the wrong side of the threshold.
 */
function share(tally: Tally, choice: Choice): number {
  if (tally.total <= 0) return 0;
  const mine = choice === 'a' ? tally.a : tally.b;
  return (mine / tally.total) * 100;
}

/**
 * How many of the hundred dots stand with you. Derived from the rounded
 * percentage so the count on screen and the number in the copy always agree —
 * "19%" must never sit next to eighteen dots.
 */
export function dotsForPercent(percent: number): number {
  return Math.min(CROWD_SIZE, Math.max(0, Math.round((percent / 100) * CROWD_SIZE)));
}

/**
 * The same count, but never allowed to erase a camp that exists.
 *
 * At the extremes rounding lies: one voter in three hundred rounds to 0%, and
 * the crowd would draw with nobody standing with you — except you are standing
 * there. Whenever both sides have a real voter, both sides keep a dot.
 */
export function dotsForTally(tally: Tally, choice: Choice): number {
  const dots = dotsForPercent(percentAgreeing(tally, choice));
  const mine = choice === 'a' ? tally.a : tally.b;
  const theirs = tally.total - mine;

  if (mine > 0 && dots < 1) return 1;
  if (theirs > 0 && dots > CROWD_SIZE - 1) return CROWD_SIZE - 1;
  return dots;
}

export function scoreVote(tally: Tally, choice: Choice, guess: number): Score {
  const actual = percentAgreeing(tally, choice);
  const error = Math.abs(guess - actual);
  const hit = error <= HIT_THRESHOLD;
  const minority = tally.total > 0 && share(tally, choice) < MINORITY_THRESHOLD;
  return {
    actual,
    error,
    hit,
    minority,
    badge: badgeFor(minority, hit),
    dotsWithYou: dotsForTally(tally, choice),
  };
}

/** Server-side validation. A guess is an integer 0-100 and nothing else. */
export function isValidGuess(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
}

export function isValidChoice(value: unknown): value is Choice {
  return value === 'a' || value === 'b';
}
