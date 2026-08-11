import { describe, expect, it } from 'vitest';

import { filterQuestionText } from '../src/server/core/filter.js';
import { NOTE_MAX_LENGTH, QUESTION_MAX_LENGTH } from '../src/shared/config.js';
import { buildComment, normalizeNote } from '../src/shared/comment.js';
import { bucketFor } from '../src/server/core/votes.js';
import { buildLockSummary } from '../src/server/core/daily.js';
import type { Question, Reveal } from '../src/shared/types.js';
import {
  normalizeQuestionText,
  validateQuestionText,
  validateSubmission,
} from '../src/shared/validate.js';

describe('question text rules', () => {
  it('accepts an ordinary habit question', () => {
    expect(validateQuestionText('Do you eat the pizza crust?')).toEqual({ ok: true });
  });

  it('requires a question mark', () => {
    expect(validateQuestionText('You eat the pizza crust').ok).toBe(false);
  });

  it('rejects more than one question', () => {
    expect(validateQuestionText('Do you? Do you really?').ok).toBe(false);
  });

  it('enforces the length bounds', () => {
    expect(validateQuestionText('Hi?').ok).toBe(false);
    expect(validateQuestionText(`${'a'.repeat(QUESTION_MAX_LENGTH)}?`).ok).toBe(false);
  });

  it('rejects links and usernames', () => {
    expect(validateQuestionText('Do you read https://example.com daily?').ok).toBe(false);
    expect(validateQuestionText('Do you follow u/spez for news?').ok).toBe(false);
  });

  it('strips zero-width characters people paste in', () => {
    expect(normalizeQuestionText('Do you​ eat  the crust?')).toBe('Do you eat the crust?');
  });

  it('needs the two answers to differ', () => {
    expect(validateSubmission('Do you eat the crust?', 'Yes', 'yes').ok).toBe(false);
    expect(validateSubmission('Do you eat the crust?', 'Yes', 'No')).toEqual({ ok: true });
  });

  it('caps label length', () => {
    expect(validateSubmission('Do you eat the crust?', 'Yes', 'A'.repeat(13)).ok).toBe(false);
  });
});

describe('the content filter', () => {
  it('lets ordinary habit questions through', () => {
    for (const text of [
      'Do you assemble furniture without the instructions?',
      'Do you visit Scunthorpe often?',
      'Do you eat the pizza crust?',
    ]) {
      expect(filterQuestionText(text), text).toEqual({ ok: true });
    }
  });

  it('blocks slurs even when they are spelled around', () => {
    expect(filterQuestionText('Do you think the f4ggot deserved it?').ok).toBe(false);
  });

  it('turns away political, medical and identity questions', () => {
    expect(filterQuestionText('Did you vote republican last election?').ok).toBe(false);
    expect(filterQuestionText('Are you vaccinated against the flu?').ok).toBe(false);
    expect(filterQuestionText('Have you been diagnosed with anything?').ok).toBe(false);
  });

  it('turns away shouting and keysmash', () => {
    expect(filterQuestionText('DO YOU EAT THE PIZZA CRUST?').ok).toBe(false);
    expect(filterQuestionText('Do you aaaaaaaa the crust?').ok).toBe(false);
  });
});

describe('the generated comment', () => {
  const question: Question = {
    id: 'h001',
    text: 'Do you eat the pizza crust?',
    labelA: 'Yes',
    labelB: 'No',
    source: 'house',
    isDaily: true,
    dailyDate: '2026-04-02',
    locked: false,
  };

  const reveal: Reveal = {
    choice: 'a',
    guess: 40,
    actual: 19,
    error: 21,
    hit: false,
    minority: true,
    badge: 'bubble',
    tally: { a: 19, b: 81, total: 100 },
    dotsWithYou: 19,
    histogram: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    provisional: false,
    commentPreview: '',
    commented: false,
    streaks: {
      playStreak: 12,
      readStreak: 0,
      totalPlayed: 30,
      totalHits: 11,
      extendedToday: true,
    },
  };

  it('needs nothing typed and still says something', () => {
    const text = buildComment(question, reveal);
    expect(text).toContain('Do you eat the pizza crust?');
    expect(text).toContain('19 out of 100 are with me');
    expect(text).toContain('Guessed 40%, actual 19%. Off by 21.');
    expect(text).toContain('Living in a bubble');
    expect(text).toContain('Play streak 12');
  });

  it('appends an optional note without disturbing the rest', () => {
    const bare = buildComment(question, reveal);
    const noted = buildComment(question, reveal, 'the crust is the best part');
    expect(noted).toContain('the crust is the best part');
    expect(noted.startsWith(bare.split('\n')[0]!)).toBe(true);
  });

  it('trims a long note on a word boundary', () => {
    const note = normalizeNote(`${'word '.repeat(60)}end`);
    expect(note.length).toBeLessThanOrEqual(NOTE_MAX_LENGTH);
    expect(note.endsWith('word')).toBe(true);
  });

  it('says "so far" only while the sample is provisional', () => {
    expect(buildComment(question, reveal)).not.toContain('so far');
    expect(buildComment(question, { ...reveal, provisional: true })).toContain('so far');
  });
});

describe('histogram buckets', () => {
  it('puts each guess in a ten-point bucket', () => {
    expect(bucketFor(0)).toBe(0);
    expect(bucketFor(9)).toBe(0);
    expect(bucketFor(10)).toBe(1);
    expect(bucketFor(55)).toBe(5);
    expect(bucketFor(99)).toBe(9);
  });

  it('folds 100 into the top bucket rather than inventing an eleventh', () => {
    expect(bucketFor(100)).toBe(9);
  });
});

describe('the locking summary', () => {
  it('leads with the majority side', () => {
    const summary = buildLockSummary('Do you eat the crust?', 'Yes', 'No', {
      a: 19,
      b: 81,
      total: 100,
    });
    expect(summary).toContain('**No 81%**');
    expect(summary).toContain('Yes 19%');
    expect(summary).toContain('Voting is closed.');
  });

  it('says so when nobody played', () => {
    expect(
      buildLockSummary('Do you eat the crust?', 'Yes', 'No', { a: 0, b: 0, total: 0 })
    ).toContain('Nobody played this one.');
  });

  it('flags a sample too small to mean anything', () => {
    expect(
      buildLockSummary('Do you eat the crust?', 'Yes', 'No', { a: 2, b: 1, total: 3 })
    ).toContain('mostly noise');
  });
});
