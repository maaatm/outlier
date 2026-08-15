import { describe, expect, it } from 'vitest';

import housePool from '../data/questions.json' with { type: 'json' };
import { HOUSE_QUESTIONS, questionAtCursor, shuffledOrder } from '../src/server/core/pool.js';
import {
  LABEL_MAX_LENGTH,
  POOL_SHUFFLE_SEED,
  QUESTION_MAX_LENGTH,
  QUESTION_MIN_LENGTH,
} from '../src/shared/config.js';
import { validateSubmission } from '../src/shared/validate.js';
import { filterText } from '../src/server/core/filter.js';

describe('the shipped house pool', () => {
  it('carries at least four months of questions', () => {
    expect(HOUSE_QUESTIONS.length).toBeGreaterThanOrEqual(120);
  });

  it('has unique ids and unique text', () => {
    const ids = new Set(HOUSE_QUESTIONS.map((q) => q.id));
    const texts = new Set(HOUSE_QUESTIONS.map((q) => q.text.toLowerCase()));
    expect(ids.size).toBe(HOUSE_QUESTIONS.length);
    expect(texts.size).toBe(HOUSE_QUESTIONS.length);
  });

  it('meets the same rules players are held to', () => {
    for (const question of HOUSE_QUESTIONS) {
      // No title: a house question reaches the subreddit through `dailyTitle`,
      // and an untyped title is exactly what the empty string means everywhere
      // else in the submission path.
      const result = validateSubmission(
        question.text,
        question.labelA ?? 'Yes',
        question.labelB ?? 'No',
        ''
      );
      expect(result, `${question.id}: ${question.text}`).toEqual({ ok: true });

      expect(question.text.length).toBeGreaterThanOrEqual(QUESTION_MIN_LENGTH);
      expect(question.text.length).toBeLessThanOrEqual(QUESTION_MAX_LENGTH);
      expect(question.labelA?.length ?? 0).toBeLessThanOrEqual(LABEL_MAX_LENGTH);
      expect(question.labelB?.length ?? 0).toBeLessThanOrEqual(LABEL_MAX_LENGTH);
    }
  });

  it('passes its own content filter', () => {
    for (const question of HOUSE_QUESTIONS) {
      expect(filterText(question.text, 'question'), question.text).toEqual({ ok: true });
    }
  });

  it('gives every question both labels or neither', () => {
    for (const question of housePool.questions) {
      expect(Boolean(question.labelA), question.id).toBe(Boolean(question.labelB));
    }
  });
});

describe('the deterministic shuffle', () => {
  it('produces the same order for the same seed', () => {
    const first = shuffledOrder(HOUSE_QUESTIONS, POOL_SHUFFLE_SEED).map((q) => q.id);
    const second = shuffledOrder(HOUSE_QUESTIONS, POOL_SHUFFLE_SEED).map((q) => q.id);
    expect(first).toEqual(second);
  });

  it('produces a different order for a different seed', () => {
    const a = shuffledOrder(HOUSE_QUESTIONS, POOL_SHUFFLE_SEED).map((q) => q.id);
    const b = shuffledOrder(HOUSE_QUESTIONS, POOL_SHUFFLE_SEED + 1).map((q) => q.id);
    expect(a).not.toEqual(b);
  });

  it('keeps every question exactly once', () => {
    const shuffled = shuffledOrder(HOUSE_QUESTIONS, POOL_SHUFFLE_SEED);
    expect(new Set(shuffled.map((q) => q.id)).size).toBe(HOUSE_QUESTIONS.length);
  });

  it('is actually shuffled rather than returned in file order', () => {
    const shuffled = shuffledOrder(HOUSE_QUESTIONS, POOL_SHUFFLE_SEED).map((q) => q.id);
    expect(shuffled).not.toEqual(HOUSE_QUESTIONS.map((q) => q.id));
  });

  it('does not mutate the pool it is given', () => {
    const before = HOUSE_QUESTIONS.map((q) => q.id);
    shuffledOrder(HOUSE_QUESTIONS, POOL_SHUFFLE_SEED);
    expect(HOUSE_QUESTIONS.map((q) => q.id)).toEqual(before);
  });
});

describe('walking the cursor', () => {
  it('never repeats until the pool is exhausted', () => {
    const size = HOUSE_QUESTIONS.length;
    const drawn = new Set<string>();
    for (let cursor = 0; cursor < size; cursor++) {
      drawn.add(questionAtCursor(cursor).id);
    }
    expect(drawn.size).toBe(size);
  });

  it('gives the same question for the same cursor every time', () => {
    expect(questionAtCursor(17).id).toBe(questionAtCursor(17).id);
    expect(questionAtCursor(0).id).toBe(questionAtCursor(0).id);
  });

  it('reorders on the next pass instead of repeating the first', () => {
    const size = HOUSE_QUESTIONS.length;
    const pass1 = Array.from({ length: size }, (_, i) => questionAtCursor(i).id);
    const pass2 = Array.from({ length: size }, (_, i) => questionAtCursor(size + i).id);
    expect(new Set(pass2).size).toBe(size);
    expect(pass2).not.toEqual(pass1);
  });
});
