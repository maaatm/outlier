/**
 * `summarizeDaily`, and which half of it owns the double-post guard.
 *
 * The job does two things to one comment: it posts it, and it distinguishes and
 * stickies it. Only the first is the job. The second is a moderator action, and
 * since Devvit 0.14.1 deprecated the `"moderator"` reddit scope the app account
 * does not have it — so on most subreddits `distinguish` now throws every single
 * time.
 *
 * That is what makes the split load-bearing rather than tidy. Both calls used to
 * sit in one `try` that released `daily:summaries` on any throw, so the
 * distinguish failing released a claim on a day whose summary was *already
 * posted* — and the guard that exists to stop a second sticky would have handed
 * one to the next run for that day. The claim now belongs to the comment alone.
 *
 * Four things are asserted, and the middle two are the regression:
 *
 *  - a summary that could not be stickied is still a summary, reported with
 *    `distinguished: false` rather than as a failure
 *  - the claim survives that, so a re-run for the same day posts nothing
 *  - a comment that never went up *does* release the claim, so the next run can
 *    try again — the recoverable direction, unchanged
 *  - the sticky is still attempted, and still reported, where it works
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  strings: new Map<string, string>(),
  hashes: new Map<string, Map<string, string>>(),
  /** Every comment body submitted, so a duplicate is visible as a second entry. */
  comments: [] as string[],
  failComment: false,
  failDistinguish: false,
  /** `distinguish` arguments, to prove the sticky flag is still passed. */
  distinguished: [] as boolean[],
}));

vi.mock('@devvit/web/server', () => {
  const hash = (key: string): Map<string, string> => {
    const existing = store.hashes.get(key);
    if (existing) return existing;
    const created = new Map<string, string>();
    store.hashes.set(key, created);
    return created;
  };

  return {
    context: { subredditName: 'playoutlier_dev' },
    redis: {
      get: async (key: string) => store.strings.get(key),
      set: async (key: string, value: string) => void store.strings.set(key, value),
      hGetAll: async (key: string) => Object.fromEntries(hash(key)),
      hGet: async (key: string, field: string) => hash(key).get(field),
      hSetNX: async (key: string, field: string, value: string) => {
        if (hash(key).has(field)) return 0;
        hash(key).set(field, value);
        return 1;
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
      zAdd: async () => undefined,
    },
    reddit: {
      submitComment: async ({ text }: { text: string }) => {
        if (store.failComment) throw new Error('Reddit would not take the comment');
        store.comments.push(text);
        return {
          id: `t1_${store.comments.length}`,
          distinguish: async (sticky: boolean) => {
            if (store.failDistinguish) throw new Error('403 forbidden');
            store.distinguished.push(sticky);
          },
        };
      },
    },
  };
});

const { summarizeDaily } = await import('../src/server/core/daily.js');

const DAY = '2026-08-23';

beforeEach(() => {
  store.strings = new Map();
  store.hashes = new Map();
  store.comments = [];
  store.failComment = false;
  store.failDistinguish = false;
  store.distinguished = [];

  store.strings.set(`daily:${DAY}`, 'q1');
  store.hashes.set(
    'q:q1',
    new Map([
      ['text', 'Do you eat the pizza crust?'],
      ['labelA', 'Yes'],
      ['labelB', 'No'],
      ['postId', 't3_daily'],
    ])
  );
  store.hashes.set('votes:q1', new Map([['a', '7'], ['b', '3']]));

  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('summarizeDaily', () => {
  it('stickies the summary where it is allowed to', async () => {
    const result = await summarizeDaily(DAY);

    expect(result).toMatchObject({ status: 'summarized', day: DAY, distinguished: true });
    expect(store.comments).toHaveLength(1);
    // `true` is the sticky flag, and it is the half of `distinguish` that puts
    // the summary at the top of the post.
    expect(store.distinguished).toEqual([true]);
  });

  it('is still summarized when it could not be stickied', async () => {
    store.failDistinguish = true;

    const result = await summarizeDaily(DAY);

    expect(result).toMatchObject({ status: 'summarized', day: DAY, distinguished: false });
    // The thing the job exists to do happened.
    expect(store.comments).toHaveLength(1);
    expect(store.comments[0]).toContain('Do you eat the pizza crust?');
  });

  it('holds the claim after a failed sticky, so the day cannot be summarized twice', async () => {
    store.failDistinguish = true;
    await summarizeDaily(DAY);

    const second = await summarizeDaily(DAY);

    expect(second).toEqual({ status: 'skipped', day: DAY, reason: 'already summarized' });
    expect(store.comments).toHaveLength(1);
  });

  it('releases the claim when the comment itself failed, and the retry works', async () => {
    store.failComment = true;
    const first = await summarizeDaily(DAY);
    expect(first).toEqual({ status: 'skipped', day: DAY, reason: 'comment failed' });
    expect(store.comments).toHaveLength(0);

    store.failComment = false;
    const second = await summarizeDaily(DAY);

    expect(second).toMatchObject({ status: 'summarized', distinguished: true });
    expect(store.comments).toHaveLength(1);
  });

  it('skips a day with no Daily behind it without claiming anything', async () => {
    expect(await summarizeDaily('2026-01-01')).toEqual({
      status: 'skipped',
      day: '2026-01-01',
      reason: 'no daily for that day',
    });
    expect(store.hashes.get('daily:summaries')).toBeUndefined();
  });
});
