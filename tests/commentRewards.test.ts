/**
 * The upvote sweep, end to end over a Redis small enough to keep in a Map and a
 * Reddit that is one function.
 *
 * The rules are covered next door in `coins.test.ts`. What is only visible once
 * the two passes, the watermark and the window are put together is here:
 *
 *  - the watermark, which is what makes a second run — or a missed one — cost
 *    latency rather than coins;
 *  - the two passes, and that a comment leaves the window exactly once it can
 *    earn nothing more;
 *  - the range itself. A reversed by-score read takes the high bound first, and
 *    handing it the two bounds the other way round returns nothing at all — a
 *    sweep that would silently never pay anybody. The fake below is faithful
 *    about that on purpose.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  hashes: new Map<string, Map<string, string>>(),
  zsets: new Map<string, Map<string, number>>(),
  /** commentId -> score, as Reddit would report it. Absent means gone. */
  comments: new Map<string, number>(),
  reads: [] as string[],
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

  return {
    redis: {
      hGet: async (key: string, field: string) => hash(key).get(field),
      hSet: async (key: string, values: Record<string, string>) => {
        for (const [field, value] of Object.entries(values)) hash(key).set(field, String(value));
      },
      hDel: async (key: string, fields: string[]) => {
        let removed = 0;
        for (const field of fields) if (hash(key).delete(field)) removed++;
        return removed;
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
      zRem: async (key: string, members: string[]) => {
        let removed = 0;
        for (const member of members) if (zset(key).delete(member)) removed++;
        return removed;
      },
      zRemRangeByRank: async () => 0,
      /**
       * By rank, and by score as Redis means it: `start` and `stop` are the
       * bounds in the order they are read, so a reversed range runs from the
       * high bound down to the low one — and a reversed range handed a low
       * bound first covers nothing.
       */
      zRange: async (
        key: string,
        start: number,
        stop: number,
        options?: { by: string; reverse?: boolean; limit?: { offset: number; count: number } }
      ) => {
        const rows = [...zset(key)]
          .map(([member, score]) => ({ member, score }))
          .sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));

        // The ledger reads by rank — it is here because `logEarning` runs on
        // the same path the sweep does, not because the sweep uses it.
        if (options?.by === 'rank') {
          const ranked = options.reverse ? [...rows].reverse() : rows;
          return ranked.slice(start, stop + 1);
        }

        const [low, high] = options?.reverse ? [stop, start] : [start, stop];
        const inRange = rows.filter((row) => row.score >= low && row.score <= high);
        // Reversed and given its bounds the wrong way round: `low > high`, and
        // nothing can satisfy it.
        const window = options?.reverse ? inRange.reverse() : inRange;

        const limit = options?.limit;
        return limit ? window.slice(limit.offset, limit.offset + limit.count) : window;
      },
    },
    reddit: {
      getCommentById: async (id: string) => {
        store.reads.push(id);
        const score = store.comments.get(id);
        if (score === undefined) throw new Error(`no comment ${id}`);
        return { score };
      },
    },
  };
});

const { sweepCommentRewards, trackComment } = await import('../src/server/core/commentRewards.js');
const { keys, userFields } = await import('../src/server/core/keys.js');
const { readEarnings } = await import('../src/server/core/earnings.js');
const { COMMENT_TRACK_HOURS, COMMENT_UPVOTE_COIN_CAP } = await import('../src/shared/config.js');

const AUTHOR = 't2_author';
const NOW = Date.parse('2026-08-17T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

/** A comment posted `agoHours` ago, sitting at `score`. */
async function track(id: string, score: number, agoHours = 0): Promise<void> {
  vi.setSystemTime(new Date(NOW - agoHours * HOUR));
  store.comments.set(id, score);
  await trackComment(AUTHOR, id);
  vi.setSystemTime(new Date(NOW));
}

const coins = (userId: string = AUTHOR): number =>
  Number(store.hashes.get(keys.user(userId))?.get(userFields.coins) ?? 0) || 0;

const tracked = (): string[] => [...(store.zsets.get(keys.commentsTracked)?.keys() ?? [])];

const paidFor = (id: string): number =>
  Number(store.hashes.get(keys.commentsPaid)?.get(id) ?? 0) || 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));

  store.hashes.clear();
  store.zsets.clear();
  store.comments.clear();
  store.reads = [];
});

describe('sweeping fresh comments', () => {
  it('pays a comment for every upvote past its own', async () => {
    await track('t1_a', 6, 2);

    const result = await sweepCommentRewards(NOW);
    // Reddit scores a new comment 1, and that one is the author's.
    expect(result.paid).toBe(5);
    expect(coins()).toBe(5);
    // Still inside its window and not at the cap, so it stays.
    expect(tracked()).toEqual(['t2_author:t1_a']);
  });

  it('pays nothing twice for the same upvotes', async () => {
    await track('t1_a', 6, 2);
    await sweepCommentRewards(NOW);

    const second = await sweepCommentRewards(NOW);
    expect(second.paid).toBe(0);
    expect(coins()).toBe(5);
  });

  it('pays only the difference when a comment climbs', async () => {
    await track('t1_a', 4, 2);
    await sweepCommentRewards(NOW);
    expect(coins()).toBe(3);

    store.comments.set('t1_a', 9);
    const second = await sweepCommentRewards(NOW);
    expect(second.paid).toBe(5);
    expect(coins()).toBe(8);
    expect(paidFor('t1_a')).toBe(8);
  });

  it('takes nothing back from a comment that falls after payment', async () => {
    await track('t1_a', 9, 2);
    await sweepCommentRewards(NOW);
    expect(coins()).toBe(8);

    store.comments.set('t1_a', -20);
    const second = await sweepCommentRewards(NOW);
    expect(second.paid).toBe(0);
    expect(coins()).toBe(8);
  });

  it('stops tracking a comment that has reached the ceiling', async () => {
    await track('t1_big', 500, 1);

    const result = await sweepCommentRewards(NOW);
    expect(result.paid).toBe(COMMENT_UPVOTE_COIN_CAP);
    expect(result.settled).toBe(1);
    // Nothing left to earn is nothing left to read: no API call next hour.
    expect(tracked()).toEqual([]);
    expect(paidFor('t1_big')).toBe(0);
  });

  it('writes a ledger line naming the upvotes rather than the coins', async () => {
    await track('t1_a', 9, 2);
    await sweepCommentRewards(NOW);

    const [entry] = await readEarnings(AUTHOR);
    expect(entry).toMatchObject({ reason: 'upvotes', coins: 8, detail: 8 });
  });
});

describe('the window closing', () => {
  it('pays a comment one last time on the way out', async () => {
    // Posted three days ago and only noticed now: the upvotes it gained on its
    // second day are still paid before it leaves.
    await track('t1_old', 5, COMMENT_TRACK_HOURS + 12);

    const result = await sweepCommentRewards(NOW);
    expect(result.paid).toBe(4);
    expect(result.settled).toBe(1);
    expect(tracked()).toEqual([]);
    // The watermark goes with the entry.
    expect(paidFor('t1_old')).toBe(0);
  });

  it('drops a comment Reddit will not hand back, once it is past the window', async () => {
    await track('t1_gone', 5, COMMENT_TRACK_HOURS + 1);
    store.comments.delete('t1_gone');

    const result = await sweepCommentRewards(NOW);
    expect(result.paid).toBe(0);
    expect(result.settled).toBe(1);
    expect(tracked()).toEqual([]);
  });

  it('keeps a comment Reddit could not answer for while it is still fresh', async () => {
    // A read that failed this hour is a read worth making again next hour.
    await track('t1_flaky', 5, 1);
    store.comments.delete('t1_flaky');

    const result = await sweepCommentRewards(NOW);
    expect(result.settled).toBe(0);
    expect(tracked()).toEqual(['t2_author:t1_flaky']);
  });

  it('does not let one bad comment cost the rest of the run', async () => {
    await track('t1_broken', 5, 1);
    await track('t1_fine', 6, 1);
    store.comments.delete('t1_broken');

    const result = await sweepCommentRewards(NOW);
    expect(result.paid).toBe(5);
    expect(coins()).toBe(5);
  });
});

describe('what the sweep reads', () => {
  it('reads the newest comments inside the window, and each of them once', async () => {
    await track('t1_new', 3, 1);
    await track('t1_mid', 3, 12);
    await track('t1_expired', 3, COMMENT_TRACK_HOURS + 2);

    await sweepCommentRewards(NOW);

    // The fresh pass runs high-bound-first, which is the whole of what makes it
    // return anything: every comment inside the window is read, plus the one
    // leaving it, and none of them twice.
    expect([...store.reads].sort()).toEqual(['t1_expired', 't1_mid', 't1_new']);
  });

  it('pays a comment sitting on the window’s edge exactly once', async () => {
    // Both passes can see this one, and the second sight of it must not pay.
    await track('t1_edge', 6, COMMENT_TRACK_HOURS);

    const result = await sweepCommentRewards(NOW);
    expect(result.paid).toBe(5);
    expect(coins()).toBe(5);
    expect(store.reads).toEqual(['t1_edge']);
  });
});
