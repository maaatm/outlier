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

export function buildComment(question: Question, reveal: Reveal, note?: string): string {
  const badge = getBadge(reveal.badge);
  const mine = labelFor(question, reveal.choice);
  const withMe = reveal.dotsWithYou;

  const lines: string[] = [];

  lines.push(`> ${question.text}`);
  lines.push('');
  lines.push(
    `**${mine}.** ${withMe} out of ${CROWD_SIZE} are with me${
      reveal.provisional ? ' so far' : ''
    }.`
  );
  lines.push('');
  lines.push(
    `Guessed ${reveal.guess}%, actual ${reveal.actual}%. Off by ${reveal.error}.`
  );
  lines.push('');
  lines.push(`**${badge.title}** — ${badge.line}`);

  if (reveal.streaks) {
    lines.push('');
    lines.push(
      `Play streak ${reveal.streaks.playStreak} · Read streak ${reveal.streaks.readStreak}`
    );
  }

  const cleanNote = normalizeNote(note);
  if (cleanNote) {
    lines.push('');
    lines.push(cleanNote);
  }

  lines.push('');
  lines.push('^(via Outlier)');

  return lines.join('\n');
}
