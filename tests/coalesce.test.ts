import { describe, expect, it } from 'vitest';

import { coalescingWriter } from '../src/client/coalesce.js';

/**
 * A `send` whose requests are resolved by hand, so the tests can put two writes
 * in flight and land them in whichever order they like. Every scenario here is
 * one the wardrobe's arrows can produce by being pressed faster than the
 * network answers.
 */
function controllable(): {
  send: (value: string) => Promise<string>;
  sent: string[];
  settle: (index: number, result?: string) => Promise<void>;
  fail: (index: number) => Promise<void>;
} {
  const sent: string[] = [];
  const pending: { resolve: (result: string) => void; reject: () => void }[] = [];

  return {
    sent,
    send: (value) =>
      new Promise<string>((resolve, reject) => {
        sent.push(value);
        pending.push({ resolve: (result) => resolve(result), reject: () => reject(new Error('no')) });
      }),
    // Awaited so the writer's own `await` continuations run before the assertion.
    settle: async (index, result) => {
      pending[index]!.resolve(result ?? `saved:${sent[index]}`);
      await flush();
    },
    fail: async (index) => {
      pending[index]!.reject();
      await flush();
    },
  };
}

/** Let every already-resolved promise continuation run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the coalescing writer', () => {
  it('sends a single value and applies its answer', async () => {
    const applied: string[] = [];
    const io = controllable();
    const push = coalescingWriter({ send: io.send, onLatest: (r) => applied.push(r) });

    push('a');
    await flush();
    expect(io.sent).toEqual(['a']);

    await io.settle(0);
    expect(applied).toEqual(['saved:a']);
  });

  it('never has two writes in flight at once', async () => {
    const io = controllable();
    const push = coalescingWriter({ send: io.send, onLatest: () => {} });

    push('a');
    await flush();
    push('b');
    push('c');
    await flush();

    // 'b' and 'c' arrived while 'a' was out. Neither goes anywhere until it lands.
    expect(io.sent).toEqual(['a']);

    await io.settle(0);
    expect(io.sent).toEqual(['a', 'c']);
  });

  it('skips the values nobody was going to see', async () => {
    const io = controllable();
    const push = coalescingWriter({ send: io.send, onLatest: () => {} });

    push('a');
    await flush();
    for (const value of ['b', 'c', 'd', 'e', 'f']) push(value);
    await flush();
    await io.settle(0);

    // A run of presses costs two writes, not one per press, and the second one
    // carries wherever the run ended up.
    expect(io.sent).toEqual(['a', 'f']);
  });

  it('always ends with the last value pushed', async () => {
    const io = controllable();
    const push = coalescingWriter({ send: io.send, onLatest: () => {} });

    push('a');
    await flush();
    push('b');
    await io.settle(0);
    push('c');
    await io.settle(1);
    await flush();

    expect(io.sent).toEqual(['a', 'b', 'c']);
    expect(io.sent[io.sent.length - 1]).toBe('c');
  });

  it('ignores the answer to a write something newer has replaced', async () => {
    // The reported bug: press, press again quickly, and the first answer lands
    // after the second press has already redrawn the screen.
    const applied: string[] = [];
    const io = controllable();
    const push = coalescingWriter({ send: io.send, onLatest: (r) => applied.push(r) });

    push('a');
    await flush();
    push('b');

    await io.settle(0);
    expect(applied).toEqual([]);

    await io.settle(1);
    expect(applied).toEqual(['saved:b']);
  });

  it('lets no answer through while a run is still going', async () => {
    const applied: string[] = [];
    const io = controllable();
    const push = coalescingWriter({ send: io.send, onLatest: (r) => applied.push(r) });

    push('a');
    await flush();
    push('b');
    await io.settle(0);
    push('c');
    await io.settle(1);

    // Only the write that turned out to be last is allowed to speak.
    expect(applied).toEqual([]);
    await io.settle(2);
    expect(applied).toEqual(['saved:c']);
  });

  it('asks for the truth when a write fails', async () => {
    const applied: string[] = [];
    const io = controllable();
    const push = coalescingWriter({
      send: io.send,
      onLatest: (r) => applied.push(r),
      recover: () => Promise.resolve('stored'),
    });

    push('a');
    await flush();
    await io.fail(0);
    await flush();

    expect(applied).toEqual(['stored']);
  });

  it('drops what it recovered if the player has moved on since', async () => {
    const applied: string[] = [];
    const io = controllable();
    let releaseRecovery = (): void => {};
    const recovered = new Promise<string>((resolve) => {
      releaseRecovery = () => resolve('stored');
    });

    const push = coalescingWriter({
      send: io.send,
      onLatest: (r) => applied.push(r),
      recover: () => recovered,
    });

    push('a');
    await flush();
    await io.fail(0);

    // A press lands while the recovery read is still out.
    push('b');
    releaseRecovery();
    await flush();

    // The stored pair is stale news now, and 'b' goes out behind it.
    expect(applied).toEqual([]);
    expect(io.sent).toEqual(['a', 'b']);

    await io.settle(1);
    expect(applied).toEqual(['saved:b']);
  });

  it('survives a recovery that fails too, and keeps writing afterwards', async () => {
    const applied: string[] = [];
    const io = controllable();
    const push = coalescingWriter({
      send: io.send,
      onLatest: (r) => applied.push(r),
      recover: () => Promise.reject(new Error('offline')),
    });

    push('a');
    await flush();
    await io.fail(0);
    await flush();

    expect(applied).toEqual([]);

    push('b');
    await flush();
    await io.settle(1);
    expect(applied).toEqual(['saved:b']);
  });

  it('does not wedge when a write fails with more already queued', async () => {
    const io = controllable();
    const push = coalescingWriter({ send: io.send, onLatest: () => {} });

    push('a');
    await flush();
    push('b');
    await io.fail(0);
    await flush();

    // A failure must not leave the newest value stranded and unsent.
    expect(io.sent).toEqual(['a', 'b']);
  });
});
