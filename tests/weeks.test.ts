import { describe, expect, it } from 'vitest';

import { addDays, fromDayKey, toWeekKey } from '../src/shared/day.js';

/** The week key for a `YYYY-MM-DD`, which is how every caller reaches it. */
const week = (day: string): string => toWeekKey(fromDayKey(day));

describe('toWeekKey', () => {
  it('numbers a week from the Monday it starts on', () => {
    // 2026-08-10 is a Monday; the Sunday that closes the same week is the 16th.
    expect(week('2026-08-10')).toBe('2026-W33');
    expect(week('2026-08-16')).toBe('2026-W33');
    expect(week('2026-08-17')).toBe('2026-W34');
  });

  it('holds one key across a whole week and turns over on Monday', () => {
    const start = '2026-08-10';
    for (let i = 0; i < 7; i++) {
      expect(week(addDays(start, i))).toBe('2026-W33');
    }
    expect(week(addDays(start, 7))).not.toBe('2026-W33');
  });

  it('keeps early January in the previous year when the week belongs there', () => {
    // 2021-01-01 was a Friday, so its week is mostly December and is 2020's.
    expect(week('2021-01-01')).toBe('2020-W53');
    expect(week('2021-01-03')).toBe('2020-W53');
    expect(week('2021-01-04')).toBe('2021-W01');

    // 2017-01-01 was a Sunday — the last day of a week that started in 2016.
    expect(week('2017-01-01')).toBe('2016-W52');
  });

  it('pulls late December into the next year when the week belongs there', () => {
    // 2019-12-30 was a Monday, so its week is mostly January and is 2020's.
    expect(week('2019-12-30')).toBe('2020-W01');
    expect(week('2019-12-31')).toBe('2020-W01');
    expect(week('2020-01-01')).toBe('2020-W01');

    expect(week('2024-12-30')).toBe('2025-W01');
  });

  it('does not split a week across two keys at a year boundary', () => {
    // The days either side of new year 2021 are one week and must key as one,
    // whichever calendar year each of them falls in.
    for (const day of ['2020-12-28', '2020-12-31', '2021-01-01', '2021-01-03']) {
      expect(week(day)).toBe('2020-W53');
    }
  });

  it('numbers a 53-week year up to 53', () => {
    expect(week('2015-12-28')).toBe('2015-W53');
    expect(week('2016-01-03')).toBe('2015-W53');
    expect(week('2016-01-04')).toBe('2016-W01');
  });

  it('pads the week number to two digits so keys sort and compare', () => {
    expect(week('2026-01-05')).toBe('2026-W02');
    expect(week('2026-03-02')).toBe('2026-W10');
  });

  it('reads UTC, not the local clock', () => {
    // Late Sunday UTC is already Monday nowhere and still last week everywhere.
    expect(toWeekKey(new Date('2026-08-16T23:59:59.000Z'))).toBe('2026-W33');
    expect(toWeekKey(new Date('2026-08-17T00:00:01.000Z'))).toBe('2026-W34');
  });
});
