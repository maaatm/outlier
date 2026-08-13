/**
 * Points, and the accuracy bands that pay them.
 *
 * Every vote pays `POINTS_BASE` for turning up. On top of that exactly one band
 * pays a bonus for how close the guess landed. The band is the brag, so the
 * label is what the reveal and the shared comment lead with — "Bullseye" is the
 * thing worth saying, and "+60" is the receipt.
 *
 * The table is ordered tightest first and read top to bottom, so `maxError` is a
 * ceiling and the last row is the floor that catches everything else. All the
 * player-facing copy lives here for the same reason it does in `badges.ts`: the
 * tone can be tuned without touching a line of logic.
 */

import { POINTS_BASE } from './config.js';

export type BandId = 'bullseye' | 'sharp' | 'close' | 'warm' | 'cold';

export type Band = {
  id: BandId;
  /** Shown on the reveal and in the shared comment. One word, always. */
  label: string;
  /** Inclusive ceiling on `|guess - actual|`. */
  maxError: number;
  bonus: number;
};

/**
 * `close` shares its ceiling with `HIT_THRESHOLD` on purpose: the point at which
 * the game says you read the room is the point at which it stops paying much
 * for it.
 */
export const BANDS: readonly Band[] = [
  { id: 'bullseye', label: 'Bullseye', maxError: 2, bonus: 50 },
  { id: 'sharp', label: 'Sharp', maxError: 5, bonus: 30 },
  { id: 'close', label: 'Close', maxError: 10, bonus: 15 },
  { id: 'warm', label: 'Warm', maxError: 20, bonus: 5 },
  { id: 'cold', label: 'Cold', maxError: 100, bonus: 0 },
];

/** The catch-all. Nothing can miss by more than 100, but nothing may fall through. */
const COLD = BANDS[BANDS.length - 1]!;

export function bandFor(error: number): Band {
  return BANDS.find((band) => error <= band.maxError) ?? COLD;
}

export function getBand(id: BandId): Band {
  return BANDS.find((band) => band.id === id) ?? COLD;
}

/** What one vote paid. Banked at vote time — see the note in `votes.ts`. */
export type Award = {
  base: number;
  bonus: number;
  total: number;
  band: BandId;
};

export function awardFor(error: number): Award {
  const band = bandFor(error);
  return {
    base: POINTS_BASE,
    bonus: band.bonus,
    total: POINTS_BASE + band.bonus,
    band: band.id,
  };
}
