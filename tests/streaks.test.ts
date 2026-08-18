import { afterEach, describe, expect, it } from 'vitest';

import { COINS_FIRST_VOTE, COINS_STREAK_BONUS } from '../src/shared/config.js';
import { addDays, daysBetween, fromDayKey, previousDay, toDayKey, toWeekKey } from '../src/shared/day.js';
import { advance, projectStats, type Play, type UserRecord } from '../src/server/core/users.js';

/** A vote worth the base rate and nothing else, for tests that are about days. */
const play: Play = { hit: false, points: 10 };
const hit: Play = { hit: true, points: 60 };

const fresh = (): UserRecord => ({
  streak: 0,
  bestStreak: 0,
  lastPlayedDay: '',
  points: 0,
  totalPlayed: 0,
  totalHits: 0,
  weekPoints: 0,
  weekKey: '',
  coins: 0,
  earnSeq: 0,
  earnSeen: 0,
});

/** A player mid-run, with everything they have banked in the week of `day`. */
const on = (day: string, streak: number, bestStreak: number = streak): UserRecord => ({
  streak,
  bestStreak,
  lastPlayedDay: day,
  points: 100,
  totalPlayed: streak,
  totalHits: 0,
  weekPoints: 100,
  weekKey: toWeekKey(fromDayKey(day)),
  coins: 40,
  // Four earnings recorded and three of them read, so this player is carrying a
  // dot — which nothing in `advance` may put out.
  earnSeq: 4,
  earnSeen: 3,
});

/** Answer one question a day, starting from nothing. */
const run = (days: string[], record: UserRecord = fresh()): UserRecord =>
  days.reduce((acc, day) => advance(acc, play, day), record);

describe('UTC day keys', () => {
  it('formats as YYYY-MM-DD in UTC regardless of the local clock', () => {
    // 23:30 UTC on the 1st is still the 1st, even where it is already the 2nd.
    expect(toDayKey(new Date('2026-03-01T23:30:00Z'))).toBe('2026-03-01');
    expect(toDayKey(new Date('2026-03-02T00:30:00Z'))).toBe('2026-03-02');
  });

  it('counts whole days across month and year boundaries', () => {
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
    expect(daysBetween('2026-01-05', '2026-01-01')).toBe(-4);
  });

  it('steps back a day', () => {
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });
});

/*
 * The day key is UTC by construction — `toISOString` cannot be anything else —
 * so these do not catch a bug in the code as written. They exist because the
 * obvious refactor is to reach for `getFullYear()/getMonth()/getDate()`, and
 * every one of these assertions flips the moment somebody does. Node re-reads
 * `process.env.TZ` on each Date operation, so setting it here really does move
 * the local clock.
 */
describe('timezone boundaries', () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it('keys the UTC day east of the line, where the local date has run ahead', () => {
    // Kiritimati is UTC+14: 11:00 UTC on the 1st is already 01:00 on the 2nd there.
    process.env.TZ = 'Pacific/Kiritimati';
    const instant = new Date('2026-04-01T11:00:00Z');
    expect(instant.getDate()).toBe(2); // the local clock says the 2nd
    expect(toDayKey(instant)).toBe('2026-04-01'); // the streak says the 1st
  });

  it('keys the UTC day west of the line, where the local date lags behind', () => {
    // Niue is UTC-11: 02:00 UTC on the 2nd is still 15:00 on the 1st there.
    process.env.TZ = 'Pacific/Niue';
    const instant = new Date('2026-04-02T02:00:00Z');
    expect(instant.getDate()).toBe(1);
    expect(toDayKey(instant)).toBe('2026-04-02');
  });

  it('does not let a local midnight count as a second day', () => {
    process.env.TZ = 'Pacific/Kiritimati';
    // Two votes three hours apart. They straddle local midnight but not UTC
    // midnight, so they are one day and the streak moves once.
    const before = toDayKey(new Date('2026-04-01T09:00:00Z')); // 23:00 local, 1st
    const after = toDayKey(new Date('2026-04-01T12:00:00Z')); // 02:00 local, 2nd
    expect(before).toBe(after);

    const first = advance(on('2026-03-31', 4), play, before);
    const second = advance(first, play, after);
    expect(first.streak).toBe(5);
    expect(second.streak).toBe(5);
    expect(second.totalPlayed).toBe(first.totalPlayed + 1);
  });

  it('does not let a local midnight break a run of UTC days', () => {
    process.env.TZ = 'Pacific/Niue';
    // Consecutive UTC days that all fall on the same local date until 13:00.
    const record = run([
      toDayKey(new Date('2026-04-01T02:00:00Z')),
      toDayKey(new Date('2026-04-02T02:00:00Z')),
      toDayKey(new Date('2026-04-03T02:00:00Z')),
    ]);
    expect(record.streak).toBe(3);
  });

  it('measures the gap in UTC days, wherever the record was written', () => {
    process.env.TZ = 'Asia/Kathmandu'; // UTC+05:45, an offset that is not a whole hour
    expect(daysBetween('2026-04-01', '2026-04-02')).toBe(1);
    expect(addDays('2026-04-01', 1)).toBe('2026-04-02');
    expect(advance(on('2026-04-01', 6), play, '2026-04-02').streak).toBe(7);
  });
});

/*
 * The transitions that break naive local-time day math. In 2026: the US springs
 * forward on 8 March and falls back on 1 November; the EU springs forward on
 * 29 March and falls back on 25 October.
 */
describe('daylight saving', () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it('counts the 23-hour local day as one day', () => {
    process.env.TZ = 'America/New_York';
    expect(daysBetween('2026-03-07', '2026-03-08')).toBe(1);
    expect(daysBetween('2026-03-08', '2026-03-09')).toBe(1);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
  });

  it('counts the 25-hour local day as one day', () => {
    process.env.TZ = 'America/New_York';
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1);
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('keeps a streak alive across the spring-forward night', () => {
    process.env.TZ = 'America/New_York';
    const record = run(['2026-03-07', '2026-03-08', '2026-03-09'], on('2026-03-06', 10));
    expect(record.streak).toBe(13);
  });

  it('keeps a streak alive across the fall-back night', () => {
    process.env.TZ = 'America/New_York';
    const record = run(['2026-10-31', '2026-11-01', '2026-11-02'], on('2026-10-30', 10));
    expect(record.streak).toBe(13);
  });

  it('does not gain or lose a day on the European transitions either', () => {
    process.env.TZ = 'Europe/London';
    expect(daysBetween('2026-03-28', '2026-03-29')).toBe(1);
    expect(daysBetween('2026-10-24', '2026-10-25')).toBe(1);
    expect(run(['2026-03-28', '2026-03-29']).streak).toBe(2);
    expect(run(['2026-10-24', '2026-10-25']).streak).toBe(2);
  });

  it('still ends a streak that skipped the transition day', () => {
    // The hour the clocks move is not a grace period for a missed day.
    process.env.TZ = 'America/New_York';
    const record = advance(on('2026-03-07', 12), play, '2026-03-09');
    expect(record.streak).toBe(1);
    expect(record.bestStreak).toBe(12);
  });
});

describe('advancing a streak', () => {
  it('starts at one on a first vote', () => {
    const next = advance(fresh(), play, '2026-04-01');
    expect(next.streak).toBe(1);
    expect(next.bestStreak).toBe(1);
    expect(next.lastPlayedDay).toBe('2026-04-01');
    expect(next.totalPlayed).toBe(1);
  });

  it('extends on consecutive days', () => {
    expect(run(['2026-04-01', '2026-04-02', '2026-04-03']).streak).toBe(3);
  });

  it('extends across a month boundary', () => {
    expect(run(['2026-04-29', '2026-04-30', '2026-05-01']).streak).toBe(3);
  });

  it('extends across a year boundary', () => {
    expect(run(['2025-12-30', '2025-12-31', '2026-01-01']).streak).toBe(3);
  });

  it('extends across a leap day', () => {
    expect(run(['2028-02-28', '2028-02-29', '2028-03-01']).streak).toBe(3);
  });

  it('resets to one after a single missed day', () => {
    const next = advance(on('2026-04-01', 12), play, '2026-04-03');
    expect(next.streak).toBe(1);
  });

  it('keeps the best streak through a missed day', () => {
    const next = advance(on('2026-04-01', 12), play, '2026-04-03');
    expect(next.bestStreak).toBe(12);
  });

  it('keeps the best streak through a long absence', () => {
    const next = advance(on('2026-04-01', 30), play, '2026-09-14');
    expect(next.streak).toBe(1);
    expect(next.bestStreak).toBe(30);
  });

  it('raises the best streak only once the current one passes it', () => {
    const record = run(['2026-04-10', '2026-04-11'], on('2026-04-09', 1, 7));
    expect(record.streak).toBe(3);
    expect(record.bestStreak).toBe(7);

    const later = run(['2026-04-12', '2026-04-13', '2026-04-14', '2026-04-15'], record);
    expect(later.streak).toBe(7);
    expect(later.bestStreak).toBe(7);

    const beyond = advance(later, play, '2026-04-16');
    expect(beyond.streak).toBe(8);
    expect(beyond.bestStreak).toBe(8);
  });

  it('leaves the streak alone on a second question the same day', () => {
    const first = advance(on('2026-04-01', 4), play, '2026-04-02');
    const second = advance(first, play, '2026-04-02');
    expect(first.streak).toBe(5);
    expect(second.streak).toBe(5);
    expect(second.lastPlayedDay).toBe('2026-04-02');
  });

  it('never rewinds when an older question is played after a newer one', () => {
    // Possible from the archive, or if a lock runs late and yesterday's post is
    // still open. Answering an extra question must not cost a streak.
    const record = on('2026-04-05', 9);
    const next = advance(record, play, '2026-04-04');

    expect(next.lastPlayedDay).toBe('2026-04-05');
    expect(next.streak).toBe(9);
    expect(next.totalPlayed).toBe(record.totalPlayed + 1);
  });
});

describe('points and totals', () => {
  it('pays every vote, including the second one in a day', () => {
    const first = advance(fresh(), hit, '2026-04-01');
    const second = advance(first, play, '2026-04-01');
    expect(first.points).toBe(60);
    expect(second.points).toBe(70);
    expect(second.totalPlayed).toBe(2);
  });

  it('pays a vote that reset the streak just the same', () => {
    const next = advance(on('2026-04-01', 12), hit, '2026-04-09');
    expect(next.streak).toBe(1);
    expect(next.points).toBe(160);
  });

  it('pays a back-dated vote without moving the day', () => {
    const next = advance(on('2026-04-05', 9), hit, '2026-04-03');
    expect(next.points).toBe(160);
    expect(next.totalHits).toBe(1);
    expect(next.lastPlayedDay).toBe('2026-04-05');
  });

  it('counts hits separately from days played', () => {
    let record = advance(fresh(), hit, '2026-04-01');
    record = advance(record, play, '2026-04-02');
    record = advance(record, hit, '2026-04-02');
    expect(record.totalPlayed).toBe(3);
    expect(record.totalHits).toBe(2);
    expect(record.streak).toBe(2);
  });
});

/*
 * The weekly total is what the default leaderboard tab ranks on, and it is the
 * one figure on the record that goes *down*. Everything here is about the
 * moment it does.
 */
describe('weekly points', () => {
  it('opens a week on the first vote of it', () => {
    const next = advance(fresh(), hit, '2026-08-12');
    expect(next.weekKey).toBe('2026-W33');
    expect(next.weekPoints).toBe(60);
    expect(next.points).toBe(60);
  });

  it('accumulates across the days of one week', () => {
    const record = run(['2026-08-10', '2026-08-13', '2026-08-16']);
    expect(record.weekKey).toBe('2026-W33');
    expect(record.weekPoints).toBe(30);
    expect(record.points).toBe(30);
  });

  it('starts the new week at the vote, not at the total carried into it', () => {
    // The whole reason the weekly board bounds archive grinding: a lead does
    // not travel across Monday.
    const record = run(['2026-08-14', '2026-08-15', '2026-08-16']);
    expect(record.weekPoints).toBe(30);

    const monday = advance(record, play, '2026-08-17');
    expect(monday.weekKey).toBe('2026-W34');
    expect(monday.weekPoints).toBe(10);
    expect(monday.points).toBe(40);
  });

  it('resets a week that was missed entirely rather than carrying it', () => {
    const record = advance(run(['2026-08-12']), play, '2026-09-30');
    expect(record.weekPoints).toBe(10);
    expect(record.points).toBe(20);
  });

  it('counts the second question of a day, which the streak does not', () => {
    const first = advance(fresh(), play, '2026-08-12');
    const second = advance(first, hit, '2026-08-12');
    expect(second.streak).toBe(1);
    expect(second.weekPoints).toBe(70);
  });

  it('pays a back-dated vote into the week it was cast in', () => {
    // `today` is always the day the vote was cast, so an archived question pays
    // into this week even when the record's last played day ran ahead.
    const record = advance(on('2026-08-19', 3), play, '2026-08-17');
    expect(record.weekKey).toBe('2026-W34');
    expect(record.weekPoints).toBe(110);
  });

  it('treats a record from before the weekly board as a week that has turned', () => {
    const legacy: UserRecord = { ...fresh(), points: 4000, totalPlayed: 200, weekKey: '' };
    const next = advance(legacy, play, '2026-08-12');
    expect(next.weekPoints).toBe(10);
    expect(next.points).toBe(4010);
  });

  it('keys the week off the day it is handed, not the local clock', () => {
    const original = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    try {
      // 2026-08-16 is a Sunday: last day of W33 in UTC, already Monday locally.
      expect(advance(fresh(), play, toDayKey(new Date('2026-08-16T11:00:00Z'))).weekKey).toBe(
        '2026-W33'
      );
    } finally {
      process.env.TZ = original;
    }
  });
});

/*
 * Coins are the second ledger and the only one that can be spent. They hang off
 * the same day boundary the streak turns on, which is why they live in
 * `advance` — the branch was already there and is already tested above.
 *
 * The rule these are all guarding: nothing here may move `points`. A score that
 * can be spent stops being a score.
 */
describe('coins', () => {
  it('pays the day rate on the first vote of a day', () => {
    const next = advance(fresh(), play, '2026-04-01');
    expect(next.coinsEarned).toBe(COINS_FIRST_VOTE);
    expect(next.coins).toBe(COINS_FIRST_VOTE);
  });

  it('pays nothing for the second question of the same day', () => {
    const first = advance(fresh(), play, '2026-04-01');
    const second = advance(first, hit, '2026-04-01');
    expect(second.coinsEarned).toBe(0);
    expect(second.coins).toBe(COINS_FIRST_VOTE);
    // The points did move, which is the difference between the two ledgers.
    expect(second.points).toBe(70);
  });

  it('adds to the balance already banked rather than replacing it', () => {
    const next = advance(on('2026-04-01', 3), play, '2026-04-02');
    expect(next.coins).toBe(40 + COINS_FIRST_VOTE);
  });

  it('pays the bonus on the day the streak reaches seven, not the day after', () => {
    const seventh = advance(on('2026-04-06', 6), play, '2026-04-07');
    expect(seventh.streak).toBe(7);
    expect(seventh.coinsEarned).toBe(COINS_FIRST_VOTE + COINS_STREAK_BONUS);

    const eighth = advance(seventh, play, '2026-04-08');
    expect(eighth.streak).toBe(8);
    expect(eighth.coinsEarned).toBe(COINS_FIRST_VOTE);
  });

  it('pays it again on 14 and 21', () => {
    const paid = (streak: number): number =>
      advance(on('2026-04-01', streak - 1), play, '2026-04-02').coinsEarned;

    for (const streak of [7, 14, 21]) {
      expect(paid(streak)).toBe(COINS_FIRST_VOTE + COINS_STREAK_BONUS);
    }
    for (const streak of [1, 6, 8, 13, 15, 20, 22]) {
      expect(paid(streak)).toBe(COINS_FIRST_VOTE);
    }
  });

  it('starts counting again from one after a reset, bonus and all', () => {
    // A run of 13 broken on the way to 14 does not pay a bonus on the next
    // vote, and does pay one seven days after the restart.
    const broken = advance(on('2026-04-01', 13), play, '2026-04-05');
    expect(broken.streak).toBe(1);
    expect(broken.coinsEarned).toBe(COINS_FIRST_VOTE);

    const seventh = run(['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10'], broken);
    const bonus = advance(seventh, play, '2026-04-11');
    expect(bonus.streak).toBe(7);
    expect(bonus.coinsEarned).toBe(COINS_FIRST_VOTE + COINS_STREAK_BONUS);
  });

  it('pays nothing on a back-dated vote, which did not open a day', () => {
    const next = advance(on('2026-04-05', 9), hit, '2026-04-03');
    expect(next.coinsEarned).toBe(0);
    expect(next.coins).toBe(40);
    expect(next.points).toBe(160);
  });

  it('never moves points, on any day that pays coins', () => {
    // The explicit statement of the rule: whatever the coins do, the points are
    // exactly what the vote paid and nothing else.
    const cases: UserRecord[] = [fresh(), on('2026-04-06', 6), on('2026-04-13', 13)];
    for (const record of cases) {
      const next = advance(record, hit, '2026-04-14');
      expect(next.points).toBe(record.points + hit.points);
      expect(next.weekPoints).toBeLessThanOrEqual(next.points);
      expect(next.coins).toBeGreaterThanOrEqual(record.coins);
    }
  });

  it('reports the day’s coins split by what paid them', () => {
    // The ledger names them separately — "turned up today" and "7 days in a
    // row" — and the sum is still what lands in the balance.
    const ordinary = advance(on('2026-04-01', 3), play, '2026-04-02');
    expect(ordinary.earned).toEqual({ daily: COINS_FIRST_VOTE, streak: 0 });

    const seventh = advance(on('2026-04-06', 6), play, '2026-04-07');
    expect(seventh.earned).toEqual({
      daily: COINS_FIRST_VOTE,
      streak: COINS_STREAK_BONUS,
    });
    expect(seventh.earned.daily + seventh.earned.streak).toBe(seventh.coinsEarned);
  });

  it('reports nothing earned on the days that pay nothing', () => {
    const twice = advance(advance(fresh(), play, '2026-04-01'), hit, '2026-04-01');
    expect(twice.earned).toEqual({ daily: 0, streak: 0 });

    const backdated = advance(on('2026-04-05', 9), hit, '2026-04-03');
    expect(backdated.earned).toEqual({ daily: 0, streak: 0 });
  });
});

/*
 * The incentives shipped alongside the ledger — comment coins, comment upvotes,
 * question royalties and the free roll for joining — are all coins, and this is
 * where that is written down.
 *
 * `advance` is the only place a vote can move a total, so it is the only place
 * one of them could have leaked into `points`. The rest of the rule is
 * structural: `royaltyFor` and `commentUpvoteOwed` return coins, `creditCoins`
 * is the only writer they reach, and neither it nor `logEarning` can name
 * `points`. The leaderboard is therefore unaffected by all five features, which
 * is what keeps it a ranking of who reads the room rather than who posts most.
 */
describe('the incentives and the leaderboard', () => {
  it('leaves points and both weekly totals untouched by every coin path', () => {
    // Nothing outside `advance` moves a point, and inside it the only thing the
    // coins can do is add to a balance the boards never read.
    const record = on('2026-04-06', 6);
    const next = advance(record, play, '2026-04-07');

    expect(next.points).toBe(record.points + play.points);
    expect(next.weekPoints).toBe(record.weekPoints + play.points);
    // The seventh day paid 25 coins on this very vote.
    expect(next.coinsEarned).toBe(COINS_FIRST_VOTE + COINS_STREAK_BONUS);
  });

  it('never puts out a dot it did not read', () => {
    // `advance` is pure and knows nothing about the ledger. The counters it was
    // handed come back exactly as they went in, whatever the vote paid.
    const record = on('2026-04-06', 6);
    const next = advance(record, hit, '2026-04-07');
    expect(next.earnSeq).toBe(record.earnSeq);
    expect(next.earnSeen).toBe(record.earnSeen);
  });
});

describe('projecting stats for the header', () => {
  it('shows a live streak on the day it was set', () => {
    const view = projectStats(on('2026-04-02', 7), '2026-04-02');
    expect(view.streak).toBe(7);
    expect(view.extendedToday).toBe(true);
  });

  it('still shows the streak the day after — today is not over', () => {
    const view = projectStats(on('2026-04-01', 7), '2026-04-02');
    expect(view.streak).toBe(7);
    expect(view.extendedToday).toBe(false);
  });

  it('reports a lapsed streak as gone rather than as its stale value', () => {
    const view = projectStats(on('2026-04-01', 7), '2026-04-05');
    expect(view.streak).toBe(0);
    expect(view.extendedToday).toBe(false);
  });

  it('keeps the best streak and the points once a streak lapses', () => {
    const view = projectStats(on('2026-04-01', 7), '2026-04-05');
    expect(view.bestStreak).toBe(7);
    expect(view.points).toBe(100);
  });

  it('shows nothing for a player who has never voted', () => {
    const view = projectStats(fresh(), '2026-04-05');
    expect(view.streak).toBe(0);
    expect(view.bestStreak).toBe(0);
    expect(view.extendedToday).toBe(false);
  });
});
