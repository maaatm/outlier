/**
 * The ledger as it is actually written and read, over a Redis small enough to
 * keep in a Map — the same approach `playerBoard.test.ts` takes, and for the
 * same reason: the codec is covered next door in `earnings.test.ts`, and what
 * is left only shows up once a write and a read are put end to end.
 *
 * Three of those: that the window is trimmed to its cap and keeps the *newest*
 * entries, that a row nothing can decode costs itself and not the ledger, and
 * that the dot on the menu goes out when the ledger is read and not before.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  hashes: new Map<string, Map<string, string>>(),
  zsets: new Map<string, Map<string, number>>(),
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
      hGet: async (key: string, field: string) => hash(key).get(field),
      hSet: async (key: string, values: Record<string, string>) => {
        for (const [field, value] of Object.entries(values)) hash(key).set(field, String(value));
      },
      hIncrBy: async (key: string, field: string, by: number) => {
        const next = (Number(hash(key).get(field) ?? 0) || 0) + by;
        hash(key).set(field, String(next));
        return next;
      },
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
      /** Inclusive, and negative indexes count back from the end, as Redis does. */
      zRemRangeByRank: async (key: string, start: number, stop: number) => {
        const rows = ordered(key);
        const from = start < 0 ? Math.max(0, rows.length + start) : start;
        const to = stop < 0 ? rows.length + stop : Math.min(stop, rows.length - 1);

        let removed = 0;
        for (let index = from; index <= to; index++) {
          const row = rows[index];
          if (!row) continue;
          zset(key).delete(row.member);
          removed++;
        }
        return removed;
      },
    },
  };
});

const { logEarning, markEarningsSeen, readEarnings } = await import(
  '../src/server/core/earnings.js'
);
const { keys, userFields } = await import('../src/server/core/keys.js');
const { EARNINGS_LOG_SIZE } = await import('../src/shared/config.js');

const PLAYER = 't2_reader';

/** What the user hash says about the dot, as `projectStats` would read it. */
const unseen = (userId: string = PLAYER): boolean => {
  const record = store.hashes.get(keys.user(userId));
  const seq = Number(record?.get(userFields.earnSeq) ?? 0) || 0;
  const seen = Number(record?.get(userFields.earnSeen) ?? 0) || 0;
  return seq > seen;
};

beforeEach(() => {
  // Every entry is stamped `Date.now()`, and the ledger is a window ordered by
  // it. A pinned clock the tests move by hand is the only way two entries a
  // millisecond apart are two entries.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-17T09:00:00.000Z'));

  store.hashes.clear();
  store.zsets.clear();
});

describe('what the ledger keeps', () => {
  it('reads back what was written, newest first', async () => {
    await logEarning(PLAYER, 'daily', 5);
    vi.advanceTimersByTime(1000);
    await logEarning(PLAYER, 'comment', 5);
    vi.advanceTimersByTime(1000);
    await logEarning(PLAYER, 'upvotes', 8, 12);

    const entries = await readEarnings(PLAYER);
    expect(entries.map((entry) => entry.reason)).toEqual(['upvotes', 'comment', 'daily']);
    expect(entries[0]).toMatchObject({ reason: 'upvotes', coins: 8, detail: 12 });
  });

  it('is a window and not a history, and the window is the newest end', async () => {
    // Twice the cap, one a second apart, each carrying its own number.
    for (let index = 0; index < EARNINGS_LOG_SIZE * 2; index++) {
      await logEarning(PLAYER, 'royalty', 1, index);
      vi.advanceTimersByTime(1000);
    }

    const entries = await readEarnings(PLAYER);
    expect(entries).toHaveLength(EARNINGS_LOG_SIZE);
    // The last one written is row one, and the oldest survivor is exactly a
    // window back — the trim took the front of the zset, not the back.
    expect(entries[0]?.detail).toBe(EARNINGS_LOG_SIZE * 2 - 1);
    expect(entries.at(-1)?.detail).toBe(EARNINGS_LOG_SIZE);
  });

  it('skips a row it cannot decode rather than losing the ones around it', async () => {
    await logEarning(PLAYER, 'daily', 5);
    vi.advanceTimersByTime(1000);
    await logEarning(PLAYER, 'submission', 10);

    // A row written by some format that no longer exists.
    store.zsets.get(keys.earnings(PLAYER))?.set('who knows', Date.now() + 1);

    const entries = await readEarnings(PLAYER);
    expect(entries.map((entry) => entry.reason)).toEqual(['submission', 'daily']);
  });

  it('records nothing for nobody', async () => {
    // A house question taking the Daily slot has no author to bill it to, which
    // is a normal Tuesday rather than something to throw over.
    await expect(logEarning('', 'promotion', 30)).resolves.toBeUndefined();
    expect(store.zsets.size).toBe(0);
    expect(store.hashes.size).toBe(0);
  });
});

describe('the dot on the menu', () => {
  it('lights on an earning and goes out when the ledger is read', async () => {
    expect(unseen()).toBe(false);

    await logEarning(PLAYER, 'upvotes', 3, 3);
    expect(unseen()).toBe(true);

    await markEarningsSeen(PLAYER);
    expect(unseen()).toBe(false);
  });

  it('lights again for the next earning, and only that one', async () => {
    await logEarning(PLAYER, 'daily', 5);
    await markEarningsSeen(PLAYER);

    vi.advanceTimersByTime(1000);
    await logEarning(PLAYER, 'royalty', 1, 100);
    expect(unseen()).toBe(true);

    await markEarningsSeen(PLAYER);
    expect(unseen()).toBe(false);
  });

  it('is one player’s dot and nobody else’s', async () => {
    await logEarning(PLAYER, 'daily', 5);
    await logEarning('t2_other', 'daily', 5);

    await markEarningsSeen(PLAYER);
    expect(unseen()).toBe(false);
    expect(unseen('t2_other')).toBe(true);
  });

  it('never leaves the dot lit for an earning that arrived while it was read', async () => {
    // `markEarningsSeen` sets the counter to what it read rather than
    // incrementing, so a race can only cost a receipt its dot — never leave one
    // that nothing can put out.
    await logEarning(PLAYER, 'daily', 5);
    await markEarningsSeen(PLAYER);
    await markEarningsSeen(PLAYER);
    expect(unseen()).toBe(false);
  });
});
