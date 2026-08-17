import { describe, expect, it } from 'vitest';

import { filterText } from '../src/server/core/filter.js';
import {
  NOTE_MAX_LENGTH,
  SUBMITTED_LABEL_MAX_LENGTH,
  SUBMITTED_QUESTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from '../src/shared/config.js';
import { buildComment, normalizeNote } from '../src/shared/comment.js';
import { bucketFor } from '../src/server/core/votes.js';
import { buildDailySummary } from '../src/server/core/daily.js';
import { toPublicQuestion } from '../src/server/core/questions.js';
import type { Question, Reveal } from '../src/shared/types.js';
import {
  fitTitle,
  normalizeQuestionText,
  normalizeTitle,
  submissionFingerprint,
  validateQuestionText,
  validateSubmission,
  validateTitle,
} from '../src/shared/validate.js';

describe('question text rules', () => {
  it('accepts an ordinary habit question', () => {
    expect(validateQuestionText('Do you eat the pizza crust?')).toEqual({ ok: true });
  });

  /*
   * Punctuation is not a rule and neither is a minimum. Both used to be, and
   * both fell on somebody who had already typed the thing. What a *good*
   * question looks like is `docs/writing-questions.md`'s business, and the mod
   * queue in front of the Daily slot is the gate that enforces any of it.
   *
   * The maximum is the exception and it is a different kind of rule: it is what
   * the question block on the screen is measured to hold, the field counts down
   * to it while it is being typed, and past it the question would be shown cut
   * off. See `SUBMITTED_QUESTION_MAX_LENGTH`.
   */
  it('does not require a question mark', () => {
    expect(validateQuestionText('You eat the pizza crust')).toEqual({ ok: true });
    expect(validateQuestionText('Crust. Yes or no')).toEqual({ ok: true });
  });

  it('has no minimum, and stops where the question block does', () => {
    expect(validateQuestionText('Crust?')).toEqual({ ok: true });
    expect(validateQuestionText('A'.repeat(SUBMITTED_QUESTION_MAX_LENGTH))).toEqual({ ok: true });
    expect(validateQuestionText('A'.repeat(SUBMITTED_QUESTION_MAX_LENGTH + 1)).ok).toBe(false);
    expect(validateQuestionText(`Do you ${'really '.repeat(200)}eat it?`).ok).toBe(false);
  });

  // Measured after the whitespace is collapsed, so nobody is refused for
  // characters that were never going to be posted.
  it('counts the question it would post, not the one that was pasted', () => {
    const padded = `Do you eat the crust?${' '.repeat(400)}`;
    expect(padded.length).toBeGreaterThan(SUBMITTED_QUESTION_MAX_LENGTH);
    expect(validateQuestionText(padded)).toEqual({ ok: true });
  });

  it('still refuses a blank one', () => {
    expect(validateQuestionText('').ok).toBe(false);
    expect(validateQuestionText('   ').ok).toBe(false);
    // Zero-width characters normalize away, so this is blank too.
    expect(validateQuestionText('​⁠').ok).toBe(false);
    expect(validateQuestionText('?!.').ok).toBe(false);
  });

  it('rejects links and usernames', () => {
    expect(validateQuestionText('Do you read https://example.com daily?').ok).toBe(false);
    expect(validateQuestionText('Do you follow u/spez for news?').ok).toBe(false);
  });

  it('strips zero-width characters people paste in', () => {
    expect(normalizeQuestionText('Do you​ eat  the crust?')).toBe('Do you eat the crust?');
  });

  it('needs the two answers to differ', () => {
    expect(validateSubmission('Do you eat the crust?', 'Yes', 'yes', '').ok).toBe(false);
    expect(validateSubmission('Do you eat the crust?', 'Yes', 'No', '')).toEqual({ ok: true });
  });

  /*
   * An answer has to fit on a button. The two choices are a fixed size — the
   * same on every question in the subreddit — so an answer longer than one
   * holds is an answer shown cut off, which is the game with half of itself
   * missing.
   */
  it('holds an answer to what fits on a button, and refuses a blank one', () => {
    const fits = 'A'.repeat(SUBMITTED_LABEL_MAX_LENGTH);
    expect(validateSubmission('Do you eat the crust?', 'Yes', fits, '')).toEqual({ ok: true });
    expect(validateSubmission('Do you eat the crust?', 'Yes', `${fits}A`, '').ok).toBe(false);
    expect(validateSubmission('Do you eat the crust?', '', 'No', '').ok).toBe(false);
    expect(validateSubmission('Do you eat the crust?', 'Yes', '   ', '').ok).toBe(false);
  });
});

/*
 * The post title. It is the half of a submission the feed shows, and it is not a
 * question — so it is held to everything that made the question safe to publish
 * and to none of the rules that are about being a question.
 */
describe('title rules', () => {
  it('takes a title that is not a question', () => {
    expect(validateTitle('The pizza crust question')).toEqual({ ok: true });
  });

  it('does not mind how many question marks it has', () => {
    expect(validateTitle('Crust? Really? Truly?')).toEqual({ ok: true });
  });

  /*
   * The one length still enforced anywhere in a submission, and only because
   * Reddit enforces it: a `submitCustomPost` over the cap is refused on their
   * side, so this is a post that will not be created rather than a matter of
   * taste. There is no lower bound — a one-word title is a title.
   */
  it('allows any length up to Reddit’s cap', () => {
    expect(validateTitle('Crust')).toEqual({ ok: true });
    expect(validateTitle('a'.repeat(TITLE_MAX_LENGTH))).toEqual({ ok: true });
    expect(validateTitle('a'.repeat(TITLE_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it('refuses a blank title when it is given one', () => {
    expect(validateTitle('').ok).toBe(false);
    expect(validateTitle('   ').ok).toBe(false);
  });

  it('needs something that reads as words', () => {
    expect(validateTitle('12345678901').ok).toBe(false);
  });

  it('rejects links and usernames', () => {
    expect(validateTitle('Settled at https://example.com').ok).toBe(false);
    expect(validateTitle('As asked by u/spez').ok).toBe(false);
  });

  /*
   * An empty title has always meant "the question was the title" — every record
   * written before the field existed means exactly that — so the fallback is
   * what keeps those and these identical rather than a convenience.
   */
  it('falls back to the question when nothing was typed', () => {
    const question = 'Do you eat the pizza crust?';
    expect(normalizeTitle('', question)).toBe(question);
    expect(normalizeTitle('   ', question)).toBe(question);
    // Zero-width space and word joiner: a title that is only the invisible
    // characters people paste in is an empty title.
    expect(normalizeTitle('​⁠', question)).toBe(question);
    expect(normalizeTitle('  Crust,  settled ​once  ', question)).toBe('Crust, settled once');
  });

  it('refuses a bad title on a good question', () => {
    const question = 'Do you eat the pizza crust?';
    expect(validateSubmission(question, 'Yes', 'No', 'Read https://example.com').ok).toBe(false);
    expect(validateSubmission(question, 'Yes', 'No', '?!.').ok).toBe(false);
    expect(validateSubmission(question, 'Yes', 'No', 'The crust question')).toEqual({ ok: true });
  });

  /*
   * A typed title past the cap is refused with a reason, because they wrote it
   * and can shorten it. A *fallback* past the cap is not a title anybody wrote,
   * so it is cut to fit rather than refusing the question it came from.
   *
   * No question a player submits today can reach the cap — they stop at
   * `SUBMITTED_QUESTION_MAX_LENGTH`, well inside it — but questions written
   * before that rule are still in Redis, and every Daily title is built from
   * one of them through here.
   */
  it('trims a long fallback to the cap instead of refusing it', () => {
    const long = `Do you ${'really '.repeat(80)}eat the pizza crust?`;
    expect(long.length).toBeGreaterThan(TITLE_MAX_LENGTH);

    const title = normalizeTitle('', long);
    expect(title.length).toBe(TITLE_MAX_LENGTH);
    expect(title.endsWith('...')).toBe(true);
    expect(long.startsWith(title.slice(0, -3))).toBe(true);
  });

  it('leaves a title that already fits exactly as it was written', () => {
    expect(normalizeTitle('The crust question', 'Do you eat it?')).toBe('The crust question');
    expect(fitTitle('The crust question')).toBe('The crust question');
  });
});

describe('the content filter', () => {
  it('lets ordinary habit questions through', () => {
    for (const text of [
      'Do you assemble furniture without the instructions?',
      'Do you visit Scunthorpe often?',
      'Do you eat the pizza crust?',
    ]) {
      expect(filterText(text, 'question'), text).toEqual({ ok: true });
    }
  });

  it('blocks slurs even when they are spelled around', () => {
    expect(filterText('Do you think the f4ggot deserved it?', 'question').ok).toBe(false);
  });

  it('turns away political, medical and identity questions', () => {
    expect(filterText('Did you vote republican last election?', 'question').ok).toBe(false);
    expect(filterText('Are you vaccinated against the flu?', 'question').ok).toBe(false);
    expect(filterText('Have you been diagnosed with anything?', 'question').ok).toBe(false);
  });

  it('turns away shouting and keysmash', () => {
    expect(filterText('DO YOU EAT THE PIZZA CRUST?', 'question').ok).toBe(false);
    expect(filterText('Do you aaaaaaaa the crust?', 'question').ok).toBe(false);
  });

  /*
   * The title is filtered too, because a field that skipped it would be an
   * unfiltered path to a real post made under the player's own account — on the
   * half of the post the feed actually shows. The rules do not vary by subject;
   * only the word the refusal uses does, so a player knows which field to fix.
   */
  it('gives the same verdict whichever subject it is given', () => {
    for (const text of [
      'Do you eat the pizza crust?',
      'The crust question, settled',
      'Do you think the f4ggot deserved it?',
      'Did you vote republican last election?',
      'WRITTEN ENTIRELY IN CAPITALS',
      'Crust aaaaaaaa crust',
    ]) {
      expect(filterText(text, 'title').ok, text).toBe(filterText(text, 'question').ok);
    }
  });

  it('names the subject it was asked about', () => {
    const slur = 'Do you think the f4ggot deserved it?';
    expect(filterText(slur, 'question')).toEqual({
      ok: false,
      reason: expect.stringContaining('question'),
    });
    expect(filterText(slur, 'title')).toEqual({
      ok: false,
      reason: expect.stringContaining('title'),
    });

    const noise = 'Crust aaaaaaaa crust';
    expect(filterText(noise, 'question')).toEqual({
      ok: false,
      reason: expect.stringContaining('question'),
    });
    expect(filterText(noise, 'title')).toEqual({
      ok: false,
      reason: expect.stringContaining('title'),
    });

    // Every refusal this filter can give names what it is refusing, including
    // the shouting rule — a player told "sentence case" while looking at four
    // fields should not have to work out which one is being complained about.
    const shouting = 'WRITTEN ENTIRELY IN CAPITALS';
    expect(filterText(shouting, 'question')).toEqual({
      ok: false,
      reason: expect.stringContaining('question'),
    });
    expect(filterText(shouting, 'title')).toEqual({
      ok: false,
      reason: expect.stringContaining('title'),
    });
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
    isToday: true,
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
    // The comment quotes the numbers on the reveal and nothing else. Neither of
    // these reaches it, and the assertions below are what say so.
    cameos: [],
    blobNotice: false,
    award: { base: 10, bonus: 0, total: 10, band: 'cold' },
    stats: {
      streak: 12,
      bestStreak: 19,
      points: 430,
      coins: 65,
      totalPlayed: 30,
      totalHits: 11,
      extendedToday: true,
    },
  };

  it('needs nothing typed and still says something', () => {
    const text = buildComment(question, reveal);
    expect(text).toContain('Yes');
    expect(text).toContain('19 of 100 are with me');
    expect(text).toContain('I guessed 40%, off by 21.');
    expect(text).toContain('Living in a bubble');
    expect(text).toContain('streak 12');
  });

  it('carries the band the vote earned, not just the number', () => {
    const bullseye: Reveal = {
      ...reveal,
      error: 1,
      award: { base: 10, bonus: 50, total: 60, band: 'bullseye' },
    };
    expect(buildComment(question, bullseye)).toContain('Bullseye +60');
    expect(buildComment(question, reveal)).toContain('Cold +10');
  });

  it('stays short enough to read without scrolling', () => {
    const text = buildComment(question, reveal);
    // One claim, one footer. Anything longer and the preview needs a scrollbar.
    expect(text.split('\n').filter((line) => line.trim() !== '')).toHaveLength(2);
    expect(text.length).toBeLessThan(200);
  });

  it('does not repeat the question the post already asks', () => {
    expect(buildComment(question, reveal)).not.toContain(question.text);
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

describe('the public question projection', () => {
  const record = {
    id: 'h001',
    text: 'Do you eat the pizza crust?',
    title: 'The crust question',
    labelA: 'Yes',
    labelB: 'No',
    authorId: '',
    authorName: '',
    source: 'house' as const,
    createdAt: 0,
    postId: 't3_abc',
    permalink: '/r/PlayOutlier/comments/abc/daily/',
    lockedAt: 0,
    dailyDate: '2026-04-02',
  };

  it('marks the current day’s Daily as today’s', () => {
    expect(toPublicQuestion(record, '2026-04-02').isToday).toBe(true);
  });

  it('does not let yesterday’s Daily keep claiming today', () => {
    const archived = toPublicQuestion(record, '2026-04-03');
    expect(archived.isToday).toBe(false);
    // Still a Daily, still open, still playable — just not the current one.
    expect(archived.isDaily).toBe(true);
    expect(archived.locked).toBe(false);
  });

  it('never calls an open question today’s', () => {
    const open = toPublicQuestion({ ...record, dailyDate: '' }, '2026-04-02');
    expect(open.isToday).toBe(false);
    expect(open.isDaily).toBe(false);
  });

  it('reports a hand-closed question as locked', () => {
    expect(toPublicQuestion({ ...record, lockedAt: 1 }, '2026-04-02').locked).toBe(true);
  });

  // The projection is deliberately narrow: it carries what it takes to draw a
  // question and nothing else. The permalink is cached for the menu's Daily
  // button and has no business on a question the client is already looking at.
  it('keeps the cached permalink off the wire', () => {
    expect(toPublicQuestion(record, '2026-04-02')).not.toHaveProperty('permalink');
  });

  // Same rule, and the title is the newer half of it: the client renders
  // `question.text`, and where the post sits in a feed is a Reddit artifact
  // rather than game content.
  it('keeps the post title off the wire', () => {
    expect(toPublicQuestion(record, '2026-04-02')).not.toHaveProperty('title');
  });
});

describe('the daily summary', () => {
  it('leads with the majority side', () => {
    const summary = buildDailySummary('Do you eat the crust?', 'Yes', 'No', {
      a: 19,
      b: 81,
      total: 100,
    });
    expect(summary).toContain('**No 81%**');
    expect(summary).toContain('Yes 19%');
    expect(summary).toContain('100 votes so far');
  });

  it('never claims the question is finished', () => {
    // Yesterday's Daily is still playable, so the sticky must not tell the
    // subreddit otherwise.
    for (const tally of [
      { a: 19, b: 81, total: 100 },
      { a: 2, b: 1, total: 3 },
      { a: 0, b: 0, total: 0 },
    ]) {
      const summary = buildDailySummary('Do you eat the crust?', 'Yes', 'No', tally);
      expect(summary).not.toContain('closed');
      expect(summary).not.toContain('final');
      expect(summary).toContain('still open');
    }
  });

  it('says so when nobody has played yet', () => {
    expect(
      buildDailySummary('Do you eat the crust?', 'Yes', 'No', { a: 0, b: 0, total: 0 })
    ).toContain('Nobody has played this one yet.');
  });

  it('flags a sample too small to mean anything', () => {
    expect(
      buildDailySummary('Do you eat the crust?', 'Yes', 'No', { a: 2, b: 1, total: 3 })
    ).toContain('mostly noise');
  });
});

/*
 * The dedupe guard's key. It replaced the 24h cooldown, and the thing it has to
 * get right is narrow: the same question twice is the same key, and two
 * different questions are not.
 */
describe('the submission fingerprint', () => {
  const ask = (text: string, a = 'Yes', b = 'No'): string => submissionFingerprint(text, a, b);

  it('is the same for the same submission', () => {
    expect(ask('Do you eat the pizza crust?')).toBe(ask('Do you eat the pizza crust?'));
  });

  it('collapses the differences a retry introduces', () => {
    // A client re-sending after a timeout may well re-normalize the text on the
    // way. Spacing and case are not a different question.
    expect(ask('Do you eat the pizza crust?')).toBe(ask('  Do you   eat the pizza crust?  '));
    expect(ask('Do you eat the pizza crust?')).toBe(ask('DO YOU EAT THE PIZZA CRUST?'));
  });

  it('separates two different questions', () => {
    expect(ask('Do you eat the pizza crust?')).not.toBe(ask('Do you eat the apple core?'));
  });

  it('separates the same question asked with different answers', () => {
    expect(ask('Do you eat the pizza crust?')).not.toBe(
      ask('Do you eat the pizza crust?', 'Always', 'Never')
    );
  });

  it('is short enough to be a hash field', () => {
    const long = `Do you ${'really '.repeat(15)}eat the pizza crust?`;
    expect(ask(long).length).toBeLessThanOrEqual(8);
  });
});
