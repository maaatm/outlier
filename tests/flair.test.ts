/**
 * Post flair, and the one property that matters about it: it cannot throw.
 *
 * Setting link flair text is a moderator action, and Devvit 0.14.1 deprecated
 * the `"moderator"` reddit scope — every app is a `"user"` now, so on a
 * subreddit that has not added the app to its mod team this call fails every
 * time. It used to ride inside `submitCustomPost` as `flairText`, where a
 * refusal was a refused *post*: no Daily for the day, or a player's question
 * rejected and one of their three for the day spent on nothing.
 *
 * So the contract under test is narrow and total. `applyFlair` reports what
 * happened and never raises, whatever Reddit does — including throwing a
 * non-`Error`, which the Reddit plugin does for some failures.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  setPostFlair: [] as unknown[],
  /** Set to make the next call reject with this. */
  reject: undefined as unknown,
}));

vi.mock('@devvit/web/server', () => ({
  reddit: {
    setPostFlair: async (options: unknown) => {
      calls.setPostFlair.push(options);
      if (calls.reject !== undefined) throw calls.reject;
    },
  },
}));

const { applyFlair } = await import('../src/server/core/flair.js');

beforeEach(() => {
  calls.setPostFlair = [];
  calls.reject = undefined;
  // The failure path logs, and a passing suite should not print it.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyFlair', () => {
  it('labels the post and says so', async () => {
    expect(await applyFlair('playoutlier', 't3_abc', 'Daily')).toBe(true);
    expect(calls.setPostFlair).toEqual([
      { subredditName: 'playoutlier', postId: 't3_abc', text: 'Daily' },
    ]);
  });

  it('answers false instead of throwing when Reddit refuses', async () => {
    calls.reject = new Error('403 forbidden');
    expect(await applyFlair('playoutlier', 't3_abc', 'Daily')).toBe(false);
  });

  it('survives a rejection that is not an Error', async () => {
    calls.reject = 'not an Error';
    expect(await applyFlair('playoutlier', 't3_abc', 'Open question')).toBe(false);
  });

  it('does not retry — one refused flair is one call', async () => {
    calls.reject = new Error('403 forbidden');
    await applyFlair('playoutlier', 't3_abc', 'Daily');
    expect(calls.setPostFlair).toHaveLength(1);
  });
});
