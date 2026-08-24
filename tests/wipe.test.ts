/**
 * The wipe, end to end over a Redis small enough to keep in a Map — the same
 * approach `ledger.test.ts` and `commentRewards.test.ts` take, and for the same
 * reason: what this file does only exists once a write and its reversal are put
 * end to end.
 *
 * Five things are only visible that way:
 *
 *  - that the reversal is *exact*. A question is voted on by two players, one is
 *    wiped, and every counter the survivor left behind has to read as though the
 *    wiped vote never happened — down to the histogram bucket and the misjudged
 *    average.
 *  - that running it twice costs nothing. The `hDel` is the claim, so a second
 *    pass must find the row gone and decrement nothing; a tally that drifts on a
 *    re-run is the whole failure this design exists to prevent.
 *  - that preview writes nothing at all. It shares the walk with the wipe, and
 *    the only thing keeping it honest is a flag.
 *  - that a vote with no banked error — one from before points existed — takes
 *    its count down without taking `errSum` with it, and that the average is
 *    recomputed rather than left standing on a count that moved.
 *  - that the last vote leaving takes the question off the misjudged board
 *    instead of dividing by zero onto it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  hashes: new Map<string, Map<string, string>>(),
  zsets: new Map<string, Map<string, number>>(),
  /** username -> id, as Reddit would answer. Absent means no such account. */
  users: new Map<string, string>(),
  /** Every key a write touched, so preview can be asserted to touch none. */
  writes: [] as string[],
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

  const wrote = (key: string): void => {
    store.writes.push(key);
  };

  return {
    redis: {
      del: async (key: string) => {
        wrote(key);
        store.hashes.delete(key);
        store.zsets.delete(key);
      },
      hGet: async (key: string, field: string) => hash(key).get(field),
      hGetAll: async (key: string) => Object.fromEntries(hash(key)),
      hSet: async (key: string, values: Record<string, string>) => {
        wrote(key);
        for (const [field, value] of Object.entries(values)) hash(key).set(field, String(value));
      },
      hDel: async (key: string, fields: string[]) => {
        wrote(key);
        let removed = 0;
        for (const field of fields) if (hash(key).delete(field)) removed++;
        return removed;
      },
      hIncrBy: async (key: string, field: string, by: number) => {
        wrote(key);
        const next = (Number(hash(key).get(field) ?? 0) || 0) + by;
        hash(key).set(field, String(next));
        return next;
      },
      zAdd: async (key: string, ...entries: { member: string; score: number }[]) => {
        wrote(key);
        for (const { member, score } of entries) zset(key).set(member, score);
      },
      zRem: async (key: string, members: string[]) => {
        wrote(key);
        let removed = 0;
        for (const member of members) if (zset(key).delete(member)) removed++;
        return removed;
      },
      /** Ascending by score, ties broken lexically by member — as Redis does it. */
      zRange: async (key: string, start: number, stop: number) => {
        const ordered = [...(store.zsets.get(key) ?? new Map<string, number>())]
          .map(([member, score]) => ({ member, score }))
          .sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));
        const end = stop < 0 ? ordered.length + stop : stop;
        return ordered.slice(start, end + 1);
      },
      zScore: async (key: string, member: string) => zset(key).get(member),
    },
    reddit: {
      getUserByUsername: async (name: string) => {
        const id = store.users.get(name);
        if (!id) throw new Error('no such user');
        return { id, username: name };
      },
    },
    context: { userId: undefined, username: undefined, subredditName: 'playoutlier_dev' },
  };
});

const { keys, voteFields } = await import('../src/server/core/keys.js');
const { wipePlayer } = await import('../src/server/core/wipe.js');

const WIPED = 't2_wiped';
const OTHER = 't2_other';

/** A question with two votes on it, written the way `castVote` writes them. */
function seedQuestion(
  questionId: string,
  votes: { userId: string; choice: 'a' | 'b'; guess: number; error?: number }[]
): void {
  const votesKey = keys.votes(questionId);
  const counters = new Map<string, string>();
  const histogram = new Map<string, string>();
  const voted = new Map<string, string>();
  const guesses = new Map<string, number>();
  const recent = new Map<string, number>();

  let a = 0;
  let b = 0;
  let guessSum = 0;
  let errSum = 0;

  for (const vote of votes) {
    if (vote.choice === 'a') a++;
    else b++;
    guessSum += vote.guess;
    errSum += vote.error ?? 0;

    const bucket = String(Math.min(9, Math.floor(vote.guess / 10)));
    histogram.set(bucket, String((Number(histogram.get(bucket) ?? 0) || 0) + 1));

    voted.set(
      vote.userId,
      vote.error === undefined
        ? `${vote.choice}:${vote.guess}`
        : `${vote.choice}:${vote.guess}:${vote.error}`
    );
    guesses.set(vote.userId, vote.guess);
    recent.set(vote.userId, Date.now());
  }

  counters.set(voteFields.a, String(a));
  counters.set(voteFields.b, String(b));
  counters.set(voteFields.guessSum, String(guessSum));
  counters.set(voteFields.guessCount, String(votes.length));
  counters.set(voteFields.errSum, String(errSum));

  store.hashes.set(votesKey, counters);
  store.hashes.set(keys.histogram(questionId), histogram);
  store.hashes.set(keys.voted(questionId), voted);
  store.hashes.set(keys.question(questionId), new Map([['text', 'Do you eat the crust?']]));
  store.zsets.set(keys.guesses(questionId), guesses);
  store.zsets.set(keys.recent(questionId), recent);
  store.zsets.set(keys.misjudged, new Map([[questionId, errSum / votes.length]]));
}

function counters(questionId: string): Record<string, string> {
  return Object.fromEntries(store.hashes.get(keys.votes(questionId)) ?? new Map());
}

beforeEach(() => {
  store.hashes.clear();
  store.zsets.clear();
  store.users.clear();
  store.writes.length = 0;
  store.users.set('wiped', WIPED);
  store.users.set('other', OTHER);
});

describe('wipePlayer', () => {
  it('reports a name Reddit does not know rather than throwing', async () => {
    const outcome = await wipePlayer('ghost', 'wipe');
    expect(outcome.status).toBe('unknown');
  });

  it('strips a leading u/ from the name it is handed', async () => {
    const outcome = await wipePlayer('u/wiped', 'preview');
    expect(outcome.status).toBe('previewed');
    if (outcome.status === 'previewed') expect(outcome.survey.userId).toBe(WIPED);
  });

  it('takes the account keys and both boards with it', async () => {
    store.hashes.set(
      keys.user(WIPED),
      new Map([
        ['points', '1240'],
        ['coins', '300'],
        ['streak', '9'],
        ['totalPlayed', '41'],
      ])
    );
    store.hashes.set(keys.inventory(WIPED), new Map([['hat', '1'], ['cap', '1']]));
    store.hashes.set(keys.earnings(WIPED), new Map([['x', '1']]));
    store.hashes.set(keys.avatars, new Map([[WIPED, 'a:b'], [OTHER, 'c:d']]));
    store.hashes.set(keys.names, new Map([[WIPED, 'wiped'], [OTHER, 'other']]));
    store.zsets.set(keys.pointsAll, new Map([[WIPED, 1240], [OTHER, 90]]));

    const outcome = await wipePlayer('wiped', 'wipe');

    expect(outcome.status).toBe('wiped');
    if (outcome.status !== 'wiped') return;
    expect(outcome.survey.points).toBe(1240);
    expect(outcome.survey.coins).toBe(300);
    expect(outcome.survey.items).toBe(2);

    expect(store.hashes.has(keys.user(WIPED))).toBe(false);
    expect(store.hashes.has(keys.inventory(WIPED))).toBe(false);
    expect(store.hashes.has(keys.earnings(WIPED))).toBe(false);
    expect(store.hashes.get(keys.avatars)?.has(WIPED)).toBe(false);
    expect(store.hashes.get(keys.names)?.has(WIPED)).toBe(false);
    expect(store.zsets.get(keys.pointsAll)?.has(WIPED)).toBe(false);

    // Nobody else moved.
    expect(store.hashes.get(keys.avatars)?.get(OTHER)).toBe('c:d');
    expect(store.zsets.get(keys.pointsAll)?.get(OTHER)).toBe(90);
  });

  it('reverses every counter the wiped vote moved, exactly', async () => {
    seedQuestion('q1', [
      { userId: WIPED, choice: 'a', guess: 80, error: 30 },
      { userId: OTHER, choice: 'b', guess: 45, error: 5 },
    ]);

    await wipePlayer('wiped', 'wipe');

    // Precisely the survivor's vote, and nothing else.
    expect(counters('q1')).toMatchObject({
      [voteFields.a]: '0',
      [voteFields.b]: '1',
      [voteFields.guessSum]: '45',
      [voteFields.guessCount]: '1',
      [voteFields.errSum]: '5',
    });

    // The wiped guess sat in bucket 8; the survivor's in bucket 4.
    const histogram = store.hashes.get(keys.histogram('q1'));
    expect(histogram?.get('8')).toBe('0');
    expect(histogram?.get('4')).toBe('1');

    // The average is the survivor's error alone, not the pair's.
    expect(store.zsets.get(keys.misjudged)?.get('q1')).toBe(5);

    // Their rows are gone; the survivor's are untouched.
    expect(store.hashes.get(keys.voted('q1'))?.has(WIPED)).toBe(false);
    expect(store.hashes.get(keys.voted('q1'))?.get(OTHER)).toBe('b:45:5');
    expect(store.zsets.get(keys.guesses('q1'))?.has(WIPED)).toBe(false);
    expect(store.zsets.get(keys.recent('q1'))?.has(WIPED)).toBe(false);
  });

  it('is idempotent — a second run moves no counter', async () => {
    seedQuestion('q1', [
      { userId: WIPED, choice: 'a', guess: 80, error: 30 },
      { userId: OTHER, choice: 'b', guess: 45, error: 5 },
    ]);

    await wipePlayer('wiped', 'wipe');
    const afterFirst = counters('q1');
    const misjudgedAfterFirst = store.zsets.get(keys.misjudged)?.get('q1');

    const second = await wipePlayer('wiped', 'wipe');

    expect(counters('q1')).toEqual(afterFirst);
    expect(store.zsets.get(keys.misjudged)?.get('q1')).toBe(misjudgedAfterFirst);
    if (second.status === 'wiped') expect(second.survey.votes).toBe(0);
  });

  it('takes the question off the misjudged board when the last vote leaves', async () => {
    seedQuestion('q1', [{ userId: WIPED, choice: 'a', guess: 80, error: 30 }]);

    await wipePlayer('wiped', 'wipe');

    expect(counters('q1')[voteFields.guessCount]).toBe('0');
    expect(store.zsets.get(keys.misjudged)?.has('q1')).toBe(false);
  });

  it('recomputes the average for a vote that banked no error', async () => {
    // A vote from before points existed: two fields, no error to subtract.
    seedQuestion('q1', [
      { userId: WIPED, choice: 'a', guess: 80 },
      { userId: OTHER, choice: 'b', guess: 45, error: 5 },
    ]);

    await wipePlayer('wiped', 'wipe');

    // `errSum` could not come down — it never went up for that vote — but the
    // count did, and the score follows the pair that survives rather than an
    // average over a count that has moved under it.
    expect(counters('q1')).toMatchObject({
      [voteFields.guessCount]: '1',
      [voteFields.errSum]: '5',
    });
    expect(store.zsets.get(keys.misjudged)?.get('q1')).toBe(5);
  });

  it('clears the byline on questions they wrote, and leaves the question up', async () => {
    store.zsets.set(keys.queuePending, new Map([['q9', 3]]));
    store.hashes.set(
      keys.question('q9'),
      new Map([
        ['text', 'Do you rinse the plate?'],
        ['authorId', WIPED],
        ['authorName', 'wiped'],
        ['source', 'community'],
      ])
    );

    const outcome = await wipePlayer('wiped', 'wipe');

    if (outcome.status === 'wiped') expect(outcome.survey.authored).toBe(1);
    const question = store.hashes.get(keys.question('q9'));
    expect(question?.get('authorId')).toBe('');
    expect(question?.get('authorName')).toBe('');
    // The question itself is still there — a live post must not be orphaned.
    expect(question?.get('text')).toBe('Do you rinse the plate?');
  });

  it('stops the sweep paying them again', async () => {
    store.zsets.set(
      keys.commentsTracked,
      new Map([
        [`${WIPED}:t1_aaa`, 1],
        [`${OTHER}:t1_bbb`, 2],
      ])
    );
    store.hashes.set(keys.commentsPaid, new Map([['t1_aaa', '4'], ['t1_bbb', '2']]));

    const outcome = await wipePlayer('wiped', 'wipe');

    if (outcome.status === 'wiped') expect(outcome.survey.comments).toBe(1);
    expect(store.zsets.get(keys.commentsTracked)?.has(`${WIPED}:t1_aaa`)).toBe(false);
    expect(store.hashes.get(keys.commentsPaid)?.has('t1_aaa')).toBe(false);
    // The other player's comment is still accruing.
    expect(store.zsets.get(keys.commentsTracked)?.has(`${OTHER}:t1_bbb`)).toBe(true);
    expect(store.hashes.get(keys.commentsPaid)?.get('t1_bbb')).toBe('2');
  });

  it('previews without writing a single key', async () => {
    store.hashes.set(keys.user(WIPED), new Map([['points', '120'], ['coins', '40']]));
    store.hashes.set(keys.inventory(WIPED), new Map([['hat', '1']]));
    store.zsets.set(keys.pointsAll, new Map([[WIPED, 120]]));
    seedQuestion('q1', [
      { userId: WIPED, choice: 'a', guess: 80, error: 30 },
      { userId: OTHER, choice: 'b', guess: 45, error: 5 },
    ]);
    store.zsets.set(keys.commentsTracked, new Map([[`${WIPED}:t1_aaa`, 1]]));

    const before = counters('q1');
    store.writes.length = 0;

    const outcome = await wipePlayer('wiped', 'preview');

    expect(outcome.status).toBe('previewed');
    if (outcome.status !== 'previewed') return;

    // It counted everything the wipe would have taken...
    expect(outcome.survey.points).toBe(120);
    expect(outcome.survey.coins).toBe(40);
    expect(outcome.survey.votes).toBe(1);
    expect(outcome.survey.items).toBe(1);
    expect(outcome.survey.comments).toBe(1);

    // ...and touched nothing.
    expect(store.writes).toEqual([]);
    expect(counters('q1')).toEqual(before);
    expect(store.hashes.get(keys.voted('q1'))?.has(WIPED)).toBe(true);
    expect(store.hashes.has(keys.user(WIPED))).toBe(true);
    expect(store.zsets.get(keys.pointsAll)?.has(WIPED)).toBe(true);
  });

  it('walks a question that only the queue knows about', async () => {
    // Not on the misjudged board, because nobody has voted on it yet.
    store.zsets.set(keys.queueApproved, new Map([['q7', 12]]));
    store.hashes.set(
      keys.question('q7'),
      new Map([['text', 'Do you sit down to put shoes on?'], ['authorId', WIPED]])
    );

    const outcome = await wipePlayer('wiped', 'preview');

    if (outcome.status === 'previewed') {
      expect(outcome.survey.scanned).toBe(1);
      expect(outcome.survey.authored).toBe(1);
    }
  });
});
