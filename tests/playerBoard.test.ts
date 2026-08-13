/**
 * The board as it is actually written and read, over a Redis small enough to
 * keep in a Map.
 *
 * The pure seams are covered next door — `boardScore` in `board.test.ts`,
 * `toWeekKey` in `weeks.test.ts`, the record fold in `streaks.test.ts`. What is
 * left is everything that only shows up once a write and a read are put end to
 * end: that two players on the same total come out in a stable order, that the
 * viewer's own row is right whether or not they are on the page, and that a
 * board never carries anything about an individual question.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  hashes: new Map<string, Map<string, string>>(),
  zsets: new Map<string, Map<string, number>>(),
  expiries: new Map<string, number>(),
  /** The accounts Reddit still knows about. Anything else has been deleted. */
  accounts: new Map<string, string>(),
  calls: { getCurrentUsername: 0, getUserById: 0 },
  context: {} as { userId?: string; username?: string },
}));

vi.mock('@devvit/web/server', () => {
  const hash = (key: string): Map<string, string> => {
    const existing = store.hashes.get(key);
    if (existing) return existing;
    const created = new Map<string, string>();
    store.hashes.set(key, created);
    return created;
  };

  const zset = (key: string): Map<string, number> => {
    const existing = store.zsets.get(key);
    if (existing) return existing;
    const created = new Map<string, number>();
    store.zsets.set(key, created);
    return created;
  };

  /** Ascending by score, ties broken lexically by member — as Redis does it. */
  const ordered = (key: string): { member: string; score: number }[] =>
    [...(store.zsets.get(key) ?? new Map<string, number>())]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));

  return {
    redis: {
      hGetAll: async (key: string) => Object.fromEntries(hash(key)),
      hGet: async (key: string, field: string) => hash(key).get(field),
      hSet: async (key: string, values: Record<string, string>) => {
        for (const [field, value] of Object.entries(values)) hash(key).set(field, String(value));
      },
      hMGet: async (key: string, fields: string[]) => fields.map((f) => hash(key).get(f) ?? null),
      zAdd: async (key: string, ...members: { member: string; score: number }[]) => {
        for (const entry of members) zset(key).set(entry.member, entry.score);
        return members.length;
      },
      zRange: async (
        key: string,
        start: number,
        stop: number,
        options?: { by: string; reverse?: boolean }
      ) => {
        const rows = ordered(key);
        return (options?.reverse ? rows.reverse() : rows).slice(start, stop + 1);
      },
      zRank: async (key: string, member: string) => {
        const index = ordered(key).findIndex((entry) => entry.member === member);
        return index === -1 ? undefined : index;
      },
      zScore: async (key: string, member: string) => store.zsets.get(key)?.get(member),
      zCard: async (key: string) => store.zsets.get(key)?.size ?? 0,
      zRem: async (key: string, members: string[]) => {
        for (const member of members) zset(key).delete(member);
        return members.length;
      },
      expire: async (key: string, seconds: number) => {
        store.expiries.set(key, seconds);
      },
    },
    reddit: {
      getCurrentUsername: async () => {
        store.calls.getCurrentUsername++;
        return store.context.username;
      },
      getUserById: async (id: string) => {
        store.calls.getUserById++;
        const username = store.accounts.get(id);
        return username === undefined ? undefined : { username };
      },
    },
    context: store.context,
  };
});

const { boardKey, readPlayerBoard } = await import('../src/server/core/leaderboard.js');
const { recordPlay } = await import('../src/server/core/users.js');
const { keys } = await import('../src/server/core/keys.js');
const { WEEK_BOARD_TTL_SECONDS } = await import('../src/shared/config.js');

/**
 * A Monday, so a week's worth of days after it stays inside one week key. Kept
 * clear of `LAUNCH_DAY`, since every day before launch clamps to the same
 * tiebreak and two of them would tie for real.
 */
const MONDAY = '2026-08-17';

/** The Monday before it. Same distance from launch, one week key earlier. */
const LAST_WEEK = '2026-08-10';

/** One vote, as the vote route would record it, from a signed-in player. */
async function play(name: string, points: number, day: string = MONDAY): Promise<void> {
  const userId = `t2_${name}`;
  store.context.userId = userId;
  store.context.username = name;
  store.accounts.set(userId, name);
  await recordPlay(userId, { hit: false, points }, day);
}

beforeEach(() => {
  // The read path resolves *this* week from the clock, since a weekly key that
  // came from anywhere else could disagree with the one the write used. So the
  // clock is pinned inside the week these tests play in.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-19T12:00:00.000Z'));

  store.hashes.clear();
  store.zsets.clear();
  store.expiries.clear();
  store.accounts.clear();
  store.calls.getCurrentUsername = 0;
  store.calls.getUserById = 0;
  // Cleared field by field: the mocked module holds this exact object, so
  // replacing it would leave the code under test reading a different one.
  store.context.userId = undefined;
  store.context.username = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('writing the boards', () => {
  it('puts a player on both boards from their first vote', async () => {
    await play('ada', 60);

    const week = await readPlayerBoard('week', 't2_ada');
    const all = await readPlayerBoard('all', 't2_ada');

    expect(week.rows).toEqual([{ rank: 1, userId: 't2_ada', name: 'ada', points: 60 }]);
    expect(all.rows).toEqual([{ rank: 1, userId: 't2_ada', name: 'ada', points: 60 }]);
  });

  it('ranks the weekly board on this week only, and all time on the lifetime total', async () => {
    await play('ada', 100, LAST_WEEK);
    await play('ada', 10, MONDAY);
    await play('bob', 60, MONDAY);

    const week = await readPlayerBoard('week');
    const all = await readPlayerBoard('all');

    // Last week's hundred does not travel; the lifetime total keeps it.
    expect(week.rows.map((row) => [row.name, row.points])).toEqual([
      ['bob', 60],
      ['ada', 10],
    ]);
    expect(all.rows.map((row) => [row.name, row.points])).toEqual([
      ['ada', 110],
      ['bob', 60],
    ]);
  });

  it('expires the weekly key so a closed week needs no sweep job', async () => {
    await play('ada', 10);

    expect(store.expiries.get(keys.pointsWeek('2026-W34'))).toBe(WEEK_BOARD_TTL_SECONDS);
    // The all-time board is forever and must never pick one up.
    expect(store.expiries.has(keys.pointsAll)).toBe(false);
  });

  it('stores a name once per player, not once per vote', async () => {
    store.context.userId = 't2_ada';
    store.context.username = 'ada';
    await recordPlay('t2_ada', { hit: false, points: 10 }, MONDAY);
    await recordPlay('t2_ada', { hit: false, points: 10 }, MONDAY);
    await recordPlay('t2_ada', { hit: false, points: 10 }, '2026-08-18');

    expect(store.hashes.get(keys.names)?.get('t2_ada')).toBe('ada');
    // `context.username` was there every time, so the API call never ran.
    expect(store.calls.getCurrentUsername).toBe(0);
  });

  it('falls back to the API when the context has no username on it', async () => {
    store.context.userId = 't2_ada';
    store.context.username = undefined;
    await recordPlay('t2_ada', { hit: false, points: 10 }, MONDAY);

    expect(store.calls.getCurrentUsername).toBe(1);
  });
});

describe('the tiebreak', () => {
  it('ranks the player who got to a total first above the one who matched it later', async () => {
    await play('ada', 50, MONDAY);
    await play('bob', 50, '2026-08-21');

    const board = await readPlayerBoard('week');
    expect(board.rows.map((row) => row.name)).toEqual(['ada', 'bob']);
    expect(board.rows.map((row) => row.points)).toEqual([50, 50]);
  });

  it('gives the same order every time it is read', async () => {
    await play('ada', 50, MONDAY);
    await play('bob', 50, '2026-08-19');
    await play('cyd', 50, '2026-08-21');

    const first = await readPlayerBoard('week');
    const second = await readPlayerBoard('week');
    const third = await readPlayerBoard('week');

    expect(first.rows).toEqual(second.rows);
    expect(second.rows).toEqual(third.rows);
    expect(first.rows.map((row) => row.name)).toEqual(['ada', 'bob', 'cyd']);
  });

  it('shows the points banked, not the score they are ranked by', async () => {
    await play('ada', 55);
    const board = await readPlayerBoard('week', 't2_ada');

    expect(board.rows[0]?.points).toBe(55);
    expect(board.you).toEqual({ rank: 1, points: 55 });
  });
});

describe('the viewer’s own row', () => {
  /** Twelve players, banked so that `bot` is last and `top` is first. */
  async function crowd(): Promise<void> {
    const names = ['top', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'bot'];
    for (const [index, name] of names.entries()) {
      await play(name, (names.length - index) * 10);
    }
  }

  it('reports a rank from outside the page', async () => {
    await crowd();
    const board = await readPlayerBoard('week', 't2_bot');

    expect(board.rows).toHaveLength(10);
    expect(board.rows.some((row) => row.userId === 't2_bot')).toBe(false);
    expect(board.you).toEqual({ rank: 12, points: 10 });
  });

  it('reports it from inside the page too, rather than leaving it out', async () => {
    await crowd();
    const board = await readPlayerBoard('week', 't2_top');

    expect(board.rows[0]?.userId).toBe('t2_top');
    expect(board.you).toEqual({ rank: 1, points: 120 });
  });

  it('agrees with the rank on the row when the player is on both', async () => {
    await crowd();
    const board = await readPlayerBoard('week', 't2_e');

    const row = board.rows.find((entry) => entry.userId === 't2_e');
    expect(board.you?.rank).toBe(row?.rank);
    expect(board.you?.points).toBe(row?.points);
  });

  it('is null for a player who has never banked on this board', async () => {
    await play('ada', 50, MONDAY);
    // Played last week, so they are on all time but not on this week's board.
    await play('bob', 10, LAST_WEEK);

    expect((await readPlayerBoard('week', 't2_bob')).you).toBeNull();
    expect((await readPlayerBoard('all', 't2_bob')).you).toEqual({ rank: 2, points: 10 });
  });

  it('is null for a signed-out reader, who can still read the board', async () => {
    await play('ada', 10);
    const board = await readPlayerBoard('week');

    expect(board.rows).toHaveLength(1);
    expect(board.you).toBeNull();
  });
});

describe('accounts that have gone', () => {
  it('drops a member whose account no longer resolves, on the read that finds it', async () => {
    await play('ada', 30);
    await play('gone', 20);
    await play('bob', 10);

    // Deleted: no name cached, and Reddit no longer has the account.
    store.hashes.get(keys.names)?.delete('t2_gone');
    store.accounts.delete('t2_gone');

    const board = await readPlayerBoard('week');

    expect(board.rows.map((row) => row.name)).toEqual(['ada', 'bob']);
    // Ranks close up rather than leaving a hole where the row was.
    expect(board.rows.map((row) => row.rank)).toEqual([1, 2]);
    expect(store.zsets.get(boardKey('week'))?.has('t2_gone')).toBe(false);

    // And it stays gone, so the lookup is paid for once.
    const before = store.calls.getUserById;
    await readPlayerBoard('week');
    expect(store.calls.getUserById).toBe(before);
  });

  it('backfills a name for a live account the hash never saw', async () => {
    await play('ada', 30);
    store.hashes.get(keys.names)?.delete('t2_ada');

    expect((await readPlayerBoard('week')).rows[0]?.name).toBe('ada');
    expect(store.hashes.get(keys.names)?.get('t2_ada')).toBe('ada');

    // Cached now, so a second read costs no API call.
    const before = store.calls.getUserById;
    await readPlayerBoard('week');
    expect(store.calls.getUserById).toBe(before);
  });
});

describe('the invariant', () => {
  it('carries nothing about any individual question', async () => {
    await play('ada', 60);
    await play('bob', 10);

    const board = await readPlayerBoard('week', 't2_bob');

    // Points are an aggregate over every question a player ever answered. There
    // is no question id, no choice, no guess and no count on this shape — and a
    // new field that carried one would fail here.
    expect(Object.keys(board).sort()).toEqual(['range', 'rows', 'you']);
    for (const row of board.rows) {
      expect(Object.keys(row).sort()).toEqual(['name', 'points', 'rank', 'userId']);
    }
    expect(Object.keys(board.you ?? {}).sort()).toEqual(['points', 'rank']);
  });
});
