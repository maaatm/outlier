/**
 * The generated comment. Shared so the preview the player taps is the comment
 * that gets posted — nothing is composed on the client and nothing differs on
 * the server.
 *
 * It is built as blocks and runs rather than as one string, because the two
 * sides now want two renderings of the same thing: the server posts richtext,
 * and the preview draws the same words on a screen. `commentBlocks` is the
 * single source both come from, so wording cannot reach the thread without
 * reaching the preview in the same commit — which is what "the preview is the
 * comment" has to mean once the posted form stops being a string.
 *
 * `buildComment` is that structure rendered to Reddit markdown. It is still
 * what the preview reads, and it is still the exact text the app posted before
 * the richtext switch, which is why every test that pins the wording is
 * unchanged.
 *
 * The player never has to type. A note may be appended, but it is optional and
 * never blocks posting.
 */

import { getBadge } from './badges.js';
import { CROWD_SIZE, NOTE_MAX_LENGTH } from './config.js';
import { getBand } from './points.js';
import type { Question, Reveal } from './types.js';

function labelFor(question: Question, choice: 'a' | 'b'): string {
  return choice === 'a' ? question.labelA : question.labelB;
}

/** Trim a note to length without cutting a word in half. */
export function normalizeNote(note: string | undefined): string {
  const trimmed = (note ?? '').replace(/\s+/g, ' ').trim();
  if (trimmed.length <= NOTE_MAX_LENGTH) return trimmed;
  const cut = trimmed.slice(0, NOTE_MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > NOTE_MAX_LENGTH * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/** One stretch of comment text, emphasised or not. */
export type CommentRun = { text: string; bold?: boolean };

/**
 * One paragraph of the comment.
 *
 * `superscript` styles the whole block rather than a run inside it, because the
 * footer is a caption and not a sentence with a small word in it. Reddit has no
 * block-level small text, so both renderings apply it across every run: the
 * markdown wraps the line in `^(...)`, and the richtext carries one format span
 * per run.
 */
export type CommentBlock = { runs: CommentRun[]; superscript?: boolean };

/**
 * Two paragraphs, three with a note, and short enough to read without scrolling
 * either in the app's preview or in the thread.
 *
 * The question itself is not quoted — the comment sits under a post that
 * already asks it, and repeating it was most of the old length. Everything that
 * survives is something the reader cannot get from the post: which side the
 * player took, how the crowd split, and how badly they read it.
 */
export function commentBlocks(
  question: Question,
  reveal: Reveal,
  note?: string
): CommentBlock[] {
  const badge = getBadge(reveal.badge);
  const mine = labelFor(question, reveal.choice);
  const soFar = reveal.provisional ? ' so far' : '';

  const blocks: CommentBlock[] = [
    {
      runs: [
        { text: 'I said ' },
        { text: mine, bold: true },
        {
          text:
            `. ${reveal.dotsWithYou} of ${CROWD_SIZE} are with me${soFar}. ` +
            `I guessed ${reveal.guess}%, off by ${reveal.error}. `,
        },
        { text: `${badge.title}.`, bold: true },
      ],
    },
  ];

  const cleanNote = normalizeNote(note);
  if (cleanNote) blocks.push({ runs: [{ text: cleanNote }] });

  // The band is today's brag and the streak is the standing one. The points
  // ride along with the band rather than on their own, because a bare number
  // means nothing to a reader who has not played.
  const band = getBand(reveal.award.band);

  blocks.push({
    runs: [
      {
        text: `streak ${reveal.stats.streak} · ${band.label} +${reveal.award.total} · via Outlier`,
      },
    ],
    superscript: true,
  });

  return blocks;
}

/**
 * The same comment as Reddit markdown. What the preview reads.
 *
 * Blocks are joined by a blank line rather than a newline: Reddit needs the
 * blank one to start a new paragraph, and this is the rendering a reader sees
 * if the richtext post ever falls back to text.
 */
export function buildComment(question: Question, reveal: Reveal, note?: string): string {
  return commentBlocks(question, reveal, note)
    .map((block) => {
      const text = block.runs.map((run) => (run.bold ? `**${run.text}**` : run.text)).join('');
      return block.superscript ? `^(${text})` : text;
    })
    .join('\n\n');
}
