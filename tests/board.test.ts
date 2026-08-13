import { describe, expect, it } from 'vitest';

import { boardPoints, boardScore, daysSinceLaunch, LAUNCH_DAY } from '../src/shared/board.js';

/** Comfortably past the horizon the tiebreak is built for. */
const PAST_HORIZON = 9000;

describe('boardScore', () => {
  it('never carries across an integer', () => {
    // The property the whole design rests on: whatever the tiebreak adds, the
    // player is still on the points they banked and nobody else's.
    for (const points of [0, 5, 10, 505, 13_570]) {
      for (const age of [0, 1, 37, 4095, 4096, PAST_HORIZON]) {
        const score = boardScore(points, age);
        expect(score).toBeGreaterThanOrEqual(points);
        expect(score).toBeLessThan(points + 1);
      }
    }
  });

  it('gives back the points it was handed', () => {
    expect(boardPoints(boardScore(0, 0))).toBe(0);
    expect(boardPoints(boardScore(505, 0))).toBe(505);
    expect(boardPoints(boardScore(505, PAST_HORIZON))).toBe(505);
  });

  it('ranks more points above fewer, whenever either was banked', () => {
    // A newcomer on 505 beats an old hand on 500. Points come first; the
    // tiebreak only ever settles a draw.
    expect(boardScore(505, 0)).toBeGreaterThan(boardScore(500, PAST_HORIZON));
    expect(boardScore(505, PAST_HORIZON)).toBeGreaterThan(boardScore(500, 0));
    expect(boardScore(1, 4095)).toBeGreaterThan(boardScore(0, 0));
  });

  it('is monotone in points at a fixed age', () => {
    let previous = -Infinity;
    for (let points = 0; points <= 400; points += 5) {
      const score = boardScore(points, 100);
      expect(score).toBeGreaterThan(previous);
      previous = score;
    }
  });

  it('ranks the player who has held a total longer above the one who just got there', () => {
    expect(boardScore(500, 10)).toBeGreaterThan(boardScore(500, 11));
    expect(boardScore(500, 0)).toBeGreaterThan(boardScore(500, 4095));
  });

  it('separates every day inside the horizon, so ties do not come back', () => {
    const scores = new Set([0, 1, 2, 500, 4094, 4095].map((age) => boardScore(500, age)));
    expect(scores.size).toBe(6);
  });

  it('clamps past the horizon rather than inverting', () => {
    // Past the horizon the fraction would go negative and rank the newest
    // arrival first. It flattens instead: equal scores, no inversion.
    expect(boardScore(500, PAST_HORIZON)).toBe(boardScore(500, 4095));
    expect(boardScore(500, PAST_HORIZON)).toBeGreaterThan(500);
  });

  it('clamps a day before launch rather than paying it a bonus point', () => {
    // Only reachable through a clock that disagrees with the launch date, but
    // an unclamped negative age would push the fraction over 1 and hand out a
    // point nobody banked.
    expect(boardScore(500, -50)).toBe(boardScore(500, 0));
    expect(boardScore(500, -50)).toBeLessThan(501);
  });
});

describe('daysSinceLaunch', () => {
  it('counts from the day the app first existed', () => {
    expect(daysSinceLaunch(LAUNCH_DAY)).toBe(0);
    expect(daysSinceLaunch('2026-08-20')).toBe(10);
  });

  it('stays inside the horizon for the runway it claims', () => {
    // ~11 years of play before the tiebreak flattens.
    expect(daysSinceLaunch('2037-01-01')).toBeLessThan(4096);
  });
});
