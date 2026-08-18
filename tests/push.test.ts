import { describe, expect, it } from 'vitest';

import { COINS_PROMOTION, PUSH_ASK_AFTER_STREAK, PUSH_BODY_MAX_LENGTH } from '../src/shared/config.js';
import {
  type PushAskInput,
  chunk,
  dailyPushCopy,
  fitPushBody,
  promotionPushCopy,
  shouldAskForPush,
} from '../src/shared/push.js';

describe('batching a fan-out', () => {
  it('makes no batches out of nobody', () => {
    // Not one empty batch. An empty batch is an `enqueue` to nobody, which is a
    // round trip spent to send nothing.
    expect(chunk([], 10)).toEqual([]);
  });

  it('divides an exact multiple evenly', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('leaves the remainder in a short last batch', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('makes one batch when the size outruns the list', () => {
    expect(chunk([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });

  it('makes a batch each at a size of one', () => {
    expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  /*
   * The case the whole function exists for. A naive loop stepping by `size`
   * never advances at zero, and a fan-out that hangs takes the scheduler run
   * with it — so zero answers with nothing rather than with everything in one
   * batch, which would be a recipient list past Reddit's cap.
   */
  it('answers with nothing at a size of zero', () => {
    expect(chunk([1, 2, 3], 0)).toEqual([]);
    expect(chunk([1, 2, 3], -1)).toEqual([]);
  });

  it('leaves the list it was handed alone', () => {
    const items = [1, 2, 3];
    chunk(items, 2);
    expect(items).toEqual([1, 2, 3]);
  });
});

const under = 'Do you eat the pizza crust?';
const exactly = 'a'.repeat(PUSH_BODY_MAX_LENGTH);
const over = `${'word '.repeat(40)}end`;

describe('fitting a question into a notification', () => {
  it('leaves a short question alone', () => {
    expect(fitPushBody(under)).toBe(under);
  });

  it('leaves one exactly at the limit alone', () => {
    expect(fitPushBody(exactly)).toBe(exactly);
  });

  it('trims a long one and says that it did', () => {
    const fitted = fitPushBody(over);
    expect(fitted.endsWith('...')).toBe(true);
    expect(over.startsWith(fitted.slice(0, -3))).toBe(true);
  });

  it('cuts back to a whole word', () => {
    // Nothing half-written survives the cut: what is left before the ellipsis
    // ends where a word ended.
    expect(fitPushBody(over).slice(0, -3).endsWith('word')).toBe(true);
  });

  it('cuts a single long word rather than returning nothing', () => {
    const oneWord = 'b'.repeat(PUSH_BODY_MAX_LENGTH + 40);
    const fitted = fitPushBody(oneWord);
    expect(fitted).toBe(`${'b'.repeat(PUSH_BODY_MAX_LENGTH - 3)}...`);
  });

  /* The property, rather than any one case: the budget includes the ellipsis. */
  it('never comes back longer than the limit', () => {
    for (const length of [0, 1, PUSH_BODY_MAX_LENGTH - 1, PUSH_BODY_MAX_LENGTH, 400]) {
      expect(fitPushBody('c'.repeat(length)).length).toBeLessThanOrEqual(PUSH_BODY_MAX_LENGTH);
      expect(fitPushBody(`${'ok '.repeat(length)}end`).length).toBeLessThanOrEqual(
        PUSH_BODY_MAX_LENGTH
      );
    }
  });
});

/**
 * The invariant, on the one shape in the app that reaches somebody who has not
 * voted. Anything numeric in a notification about a question is a number about
 * how that question is going, and the reader has not earned it.
 */
function numbersIn(copy: { title: string; body: string }): string[] {
  return `${copy.title} ${copy.body}`.match(/\d+/g) ?? [];
}

describe('what a notification is allowed to say', () => {
  it('says the Daily is up and nothing measurable about it', () => {
    const copy = dailyPushCopy(under);
    expect(copy.title).toBe("Today's Outlier is up");
    expect(copy.body).toBe(under);
    expect(numbersIn(copy)).toEqual([]);
  });

  it('tells one author their question was chosen, and what it paid', () => {
    const copy = promotionPushCopy(under, COINS_PROMOTION);
    expect(copy.body).toContain(under);
    expect(copy.body).toContain(`+${COINS_PROMOTION} coins.`);
  });

  it('carries the coin award and no other number', () => {
    expect(numbersIn(promotionPushCopy(under, COINS_PROMOTION))).toEqual([
      String(COINS_PROMOTION),
    ]);
  });

  it('trims the question in both, so neither can run past the budget', () => {
    expect(dailyPushCopy(over).body.length).toBeLessThanOrEqual(PUSH_BODY_MAX_LENGTH);
    expect(promotionPushCopy(over, COINS_PROMOTION).body).toContain('...');
  });
});

/** Every gate open. Each case below shuts exactly one of them. */
const asking: PushAskInput = {
  enabled: true,
  available: true,
  optedIn: false,
  asked: false,
  blobNotice: false,
  streak: PUSH_ASK_AFTER_STREAK,
};

describe('whether to put the question to a player', () => {
  it('asks once every gate is open', () => {
    expect(shouldAskForPush(asking)).toBe(true);
  });

  it('never asks with the feature off', () => {
    expect(shouldAskForPush({ ...asking, enabled: false })).toBe(false);
  });

  it('never asks when the plugin did not answer', () => {
    expect(shouldAskForPush({ ...asking, available: false })).toBe(false);
  });

  it('does not ask somebody who has already said yes', () => {
    expect(shouldAskForPush({ ...asking, optedIn: true })).toBe(false);
  });

  it('does not ask twice', () => {
    expect(shouldAskForPush({ ...asking, asked: true })).toBe(false);
  });

  it('stands aside for the blob notice', () => {
    expect(shouldAskForPush({ ...asking, blobNotice: true })).toBe(false);
  });

  it('waits for the streak', () => {
    expect(shouldAskForPush({ ...asking, streak: PUSH_ASK_AFTER_STREAK - 1 })).toBe(false);
    expect(shouldAskForPush({ ...asking, streak: 0 })).toBe(false);
    expect(shouldAskForPush({ ...asking, streak: PUSH_ASK_AFTER_STREAK + 5 })).toBe(true);
  });
});
