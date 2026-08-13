/**
 * The score a player sits at on a leaderboard: their points, with the tiebreak
 * folded into the fraction underneath.
 *
 * Points land on multiples of 5, so exact ties are the common case rather than
 * the rare one. Redis breaks a tie by ordering tied members lexically, which
 * would silently rank players by account ID — a hidden rule nobody can see or
 * beat. Encoding the tiebreak into the score itself removes the tie instead of
 * arbitrating it.
 *
 * It also buys the read path a shortcut: Devvit's Redis has no `zCount`, so
 * there is no cheap way to count the players above a given score. With no ties
 * to resolve, `zRank` alone is an unambiguous rank and needs no second lookup.
 */

import { daysBetween, toDayKey, type DayKey } from './day.js';

/** Days of runway the tiebreak has before it flattens. ~11 years. */
const TIE_HORIZON = 4096;

/**
 * Of two players on the same total, the one who has been sitting on it longer
 * ranks higher — the later you arrived at a number, the less it is worth.
 *
 * Safe because points are integers: the fraction can never carry across one, so
 * a player on 500 can never outrank a player on 505 however early they got
 * there. `Math.floor` recovers the points exactly, which is what a board row
 * displays.
 *
 * The divisor is `TIE_HORIZON + 1` rather than `TIE_HORIZON` so that the
 * fraction stays *strictly* inside 0 and 1 at both ends. On launch day itself
 * the numerator is the whole horizon, and dividing by the horizon would hand
 * back exactly 1.0 — a player would be stored, and displayed, one point above
 * what they had actually banked.
 *
 * Past the horizon the age clamps rather than running negative, which would
 * invert the rule and make the newest arrival rank first.
 */
export function boardScore(points: number, daysSinceLaunch: number): number {
  const age = Math.min(Math.max(daysSinceLaunch, 0), TIE_HORIZON - 1);
  return points + (TIE_HORIZON - age) / (TIE_HORIZON + 1);
}

/** The points back out of a board score. What a row shows. */
export function boardPoints(score: number): number {
  return Math.floor(score);
}

/**
 * The day the app first existed. The tiebreak measures from here rather than
 * from an epoch, so none of the horizon is spent on days nobody could play.
 */
export const LAUNCH_DAY: DayKey = '2026-08-10';

/** Age of a day in the tiebreak's terms. Clamped by `boardScore` either way. */
export function daysSinceLaunch(today: DayKey = toDayKey()): number {
  return daysBetween(LAUNCH_DAY, today);
}
