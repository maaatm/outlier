/**
 * `POST /api/join`, end to end over a Redis small enough to keep in a Map — the
 * same approach `ledger.test.ts` and `wipe.test.ts` take, and for the same
 * reason: the grant is a claim, a credit and a Reddit call in one request, and
 * none of the three says anything on its own.
 *
 * Five things only show up that way:
 *
 *  - that the roll is paid **once per account**, however many taps arrive
 *    together. The claim is the only thing standing between one free box and
 *    one per tap.
 *  - that a decline can still become a claim. `joined` holds `"0"` afterwards
 *    and `hSetNX` cannot move it, which is exactly why the claim is a field of
 *    its own — a player who said "not now" must not have paid for it forever.
 *  - that an account granted before that field existed is not paid twice. It
 *    carries `joined === "1"` and no claim, so the claim alone would hand it a
 *    second roll.
 *  - that Reddit refusing the subscription does not take the box with it. That
 *    refusal used to answer the tap with a 500 and claim nothing, so every
 *    retry ran the same call and failed the same way — the button was dead for
 *    that account for good.
 *  - that the ledger gets exactly one line out of all of it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JOIN_FREE_ROLLS } from '../src/shared/config.js';

const store = vi.hoisted(() => ({
  hashes: new Map<string, Map<string, string>>(),
  zsets: new Map<string, Map<string, number>>(),
  /** Who is signed in. Absent is signed out, which the route refuses. */
  userId: undefined as string | undefined,
  /** How many times Reddit was asked to subscribe this player. */
  subscribes: 0,
  /** Set to make `subscribeToCurrentSubreddit` throw, as Reddit may. */
  subscribeFails: false,
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
    context: {
      get userId(): string | undefined {
        return store.userId;
      },
      postId: 't3_post',
      subredditName: 'playoutlier',
    },
    reddit: {
      subscribeToCurrentSubreddit: async (): Promise<void> => {
        store.subscribes++;
        if (store.subscribeFails) throw new Error('Reddit said no.');
      },
    },
    redis: {
      hGet: async (key: string, field: string) => hash(key).get(field),
      hGetAll: async (key: string) => Object.fromEntries(hash(key)),
      hMGet: async (key: string, fields: string[]) =>
        fields.map((field) => hash(key).get(field) ?? null),
      hSet: async (key: string, values: Record<string, string>) => {
        let added = 0;
        for (const [field, value] of Object.entries(values)) {
          if (!hash(key).has(field)) added++;
          hash(key).set(field, String(value));
        }
        return added;
      },
      // Redis answers 1 when it wrote and 0 when the field was already there,
      // and that number is the whole guard this route rests on.
      hSetNX: async (key: string, field: string, value: string) => {
        if (hash(key).has(field)) return 0;
        hash(key).set(field, value);
        return 1;
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
      zRemRangeByRank: async () => 0,
      zRange: async () => [],
      get: async () => undefined,
      set: async () => 'OK',
      del: async () => 0,
    },
  };
});

const { api } = await import('../src/server/routes/api.js');

const USER = 't2_player';
const USER_KEY = `user:${USER}`;

type JoinBody = {
  joined: boolean;
  granted: boolean;
  freeRolls: number;
  subscribed: boolean;
};

async function join(decline = false): Promise<{ status: number; body: JoinBody }> {
  const response = await api.request('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decline }),
  });
  return { status: response.status, body: (await response.json()) as JoinBody };
}

/** What is on the user hash, as the next request would read it. */
function field(name: string): string | undefined {
  return store.hashes.get(USER_KEY)?.get(name);
}

/** Ledger lines of one kind. The reason is the second colon-separated part. */
function earnings(reason: string): string[] {
  return [...(store.zsets.get(`earn:${USER}`)?.keys() ?? [])].filter(
    (member) => member.split(':')[1] === reason
  );
}

describe('POST /api/join', () => {
  beforeEach(() => {
    store.hashes.clear();
    store.zsets.clear();
    store.userId = USER;
    store.subscribes = 0;
    store.subscribeFails = false;
  });

  it('subscribes, grants the roll and answers the offer', async () => {
    const { status, body } = await join();

    expect(status).toBe(200);
    expect(body).toEqual({
      joined: true,
      granted: true,
      freeRolls: JOIN_FREE_ROLLS,
      subscribed: true,
    });
    expect(store.subscribes).toBe(1);
    expect(field('joined')).toBe('1');
    expect(field('freeRolls')).toBe(String(JOIN_FREE_ROLLS));
    expect(earnings('join')).toHaveLength(1);
  });

  it('pays the roll once, however many taps arrive', async () => {
    await join();
    const second = await join();

    expect(second.status).toBe(200);
    expect(second.body.granted).toBe(false);
    expect(second.body.joined).toBe(true);
    expect(field('freeRolls')).toBe(String(JOIN_FREE_ROLLS));
    // The subscribe is idempotent on Reddit's side, so it still runs — the box
    // is the half that is once per account.
    expect(store.subscribes).toBe(2);
    expect(earnings('join')).toHaveLength(1);
  });

  it('pays one roll for two taps racing each other', async () => {
    const [first, second] = await Promise.all([join(), join()]);

    expect([first.body.granted, second.body.granted].filter(Boolean)).toHaveLength(1);
    expect(field('freeRolls')).toBe(String(JOIN_FREE_ROLLS));
    expect(earnings('join')).toHaveLength(1);
  });

  it('lets a no become a yes', async () => {
    const declined = await join(true);

    expect(declined.body).toEqual({
      joined: false,
      granted: false,
      freeRolls: 0,
      subscribed: false,
    });
    expect(field('joined')).toBe('0');
    expect(store.subscribes).toBe(0);

    // The whole reason the claim is not `joined`: `hSetNX` can never move the
    // "0" a decline leaves behind.
    const claimed = await join();

    expect(claimed.body.granted).toBe(true);
    expect(claimed.body.freeRolls).toBe(JOIN_FREE_ROLLS);
    expect(field('joined')).toBe('1');
  });

  it('does not let a decline undo a claim', async () => {
    await join();
    const declined = await join(true);

    expect(field('joined')).toBe('1');
    expect(declined.body.joined).toBe(true);
    expect(field('freeRolls')).toBe(String(JOIN_FREE_ROLLS));
  });

  it('does not pay an account granted before the claim field existed', async () => {
    // What the old grant left behind: the answer, and no claim beside it.
    store.hashes.set(
      USER_KEY,
      new Map([
        ['joined', '1'],
        ['freeRolls', '1'],
      ])
    );

    const { body } = await join();

    expect(body.granted).toBe(false);
    expect(body.freeRolls).toBe(1);
    expect(field('freeRolls')).toBe('1');
    expect(earnings('join')).toHaveLength(0);
  });

  it('still hands over the box when Reddit refuses the subscription', async () => {
    store.subscribeFails = true;

    const { status, body } = await join();

    expect(status).toBe(200);
    expect(body.granted).toBe(true);
    expect(body.freeRolls).toBe(JOIN_FREE_ROLLS);
    // The one thing this response knows for certain, and the reveal says it.
    expect(body.subscribed).toBe(false);
    expect(field('joined')).toBe('1');
  });

  it('refuses a signed-out player and claims nothing', async () => {
    store.userId = undefined;

    const response = await api.request('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(401);
    expect(store.subscribes).toBe(0);
    expect(store.hashes.get(USER_KEY)).toBeUndefined();
  });
});
