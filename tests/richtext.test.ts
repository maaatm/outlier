/**
 * The comment as Reddit will receive it.
 *
 * `tests/validation.test.ts` pins what the comment *says*, through the markdown
 * rendering. This pins what is actually submitted, which is now a different
 * object — and the two things worth pinning about it are both silent when they
 * are wrong.
 *
 * A `FormatRange` is `[flag, startIndex, length]`. Read as a start and an end it
 * still encodes, still posts, and still comes back with a permalink; it just
 * emphasises the wrong characters. Nothing downstream can catch that, so it is
 * caught here.
 *
 * The other is the note. It is the one part of the comment a player writes, it
 * goes into a plain run, and it must stay one — a note that reached the
 * formatter would be a player styling a comment the preview said was flat.
 */

import { describe, expect, it } from 'vitest';

import { commentBlocks } from '../src/shared/comment.js';
import { toRichText } from '../src/server/core/richtext.js';
import type { Question, Reveal } from '../src/shared/types.js';

const BOLD = 1;
const SUPERSCRIPT = 32;

type Run = { e: string; t: string; f?: [number, number, number][] };
type Paragraph = { e: string; c: Run[] };

const question = {
  id: 'q1',
  text: 'Do you eat the pizza crust?',
  title: 'Do you eat the pizza crust?',
  labelA: 'Yes',
  labelB: 'No',
  source: 'house',
  locked: false,
} as unknown as Question;

const reveal = {
  choice: 'a',
  guess: 40,
  error: 21,
  badge: 'bubble',
  dotsWithYou: 19,
  provisional: false,
  commented: false,
  commentPreview: '',
  award: { base: 10, bonus: 0, total: 10, band: 'cold' },
  stats: {
    streak: 12,
    bestStreak: 19,
    points: 430,
    coins: 65,
    totalPlayed: 30,
    totalHits: 11,
    extendedToday: true,
    unseenEarnings: false,
  },
} as unknown as Reveal;

function paragraphs(note?: string): Paragraph[] {
  const built = toRichText(commentBlocks(question, reveal, note)).build();
  return (JSON.parse(built) as { document: Paragraph[] }).document;
}

describe('the comment Reddit receives', () => {
  it('is one paragraph per block, and a note adds one', () => {
    expect(paragraphs()).toHaveLength(2);
    expect(paragraphs('the crust is the best part')).toHaveLength(3);
  });

  it('emphasises the side taken and the badge, and nothing between them', () => {
    const runs = paragraphs()[0]!.c;
    const bold = runs.filter((run) => run.f?.some(([flag]) => flag === BOLD));

    expect(bold.map((run) => run.t)).toEqual(['Yes', 'Living in a bubble.']);
    // The whole of each run, from its own zero — a start and an end would put
    // the second span three characters wide instead of nineteen.
    for (const run of bold) expect(run.f).toEqual([[BOLD, 0, run.t.length]]);
  });

  it('makes the footer a caption rather than a line of markup', () => {
    const footer = paragraphs().at(-1)!.c[0]!;

    expect(footer.t).toBe('streak 12 · Cold +10 · via Outlier');
    expect(footer.f).toEqual([[SUPERSCRIPT, 0, footer.t.length]]);
    // The markers belong to the markdown rendering and travel no further.
    expect(footer.t).not.toContain('^(');
  });

  it("hands the player's note over as characters, not as markup", () => {
    const note = paragraphs('the **crust** is the best part')[1]!.c;

    expect(note).toHaveLength(1);
    expect(note[0]!.t).toBe('the **crust** is the best part');
    expect(note[0]!.f).toBeUndefined();
  });
});
