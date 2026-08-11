/**
 * The generated comment. Shared so the preview the player taps is byte-for-byte
 * the comment that gets posted — nothing is composed on the client and nothing
 * differs on the server.
 *
 * The player never has to type. A note may be appended, but it is optional and
 * never blocks posting.
 */

import { getBadge } from './badges.js';
import { CROWD_SIZE, NOTE_MAX_LENGTH } from './config.js';
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

/**
 * Two lines, and short enough to read without scrolling either in the app's
 * preview or in the thread.
 *
 * The question itself is not quoted — the comment sits under a post that
 * already asks it, and repeating it was most of the old length. Everything that
 * survives is something the reader cannot get from the post: which side the
 * player took, how the crowd split, and how badly they read it.
 */
export function buildComment(question: Question, reveal: Reveal, note?: string): string {
  const badge = getBadge(reveal.badge);
  const mine = labelFor(question, reveal.choice);
  const soFar = reveal.provisional ? ' so far' : '';

  const lines: string[] = [
    `**${mine}** — ${reveal.dotsWithYou} of ${CROWD_SIZE} are with me${soFar}. ` +
      `I guessed ${reveal.guess}%, off by ${reveal.error}. **${badge.title}.**`,
  ];

  const cleanNote = normalizeNote(note);
  if (cleanNote) {
    lines.push('');
    lines.push(cleanNote);
  }

  const streak = reveal.streaks
    ? `play ${reveal.streaks.playStreak} · read ${reveal.streaks.readStreak} · `
    : '';

  lines.push('');
  lines.push(`^(${streak}via Outlier)`);

  return lines.join('\n');
}
