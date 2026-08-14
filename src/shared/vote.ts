/**
 * What a vote looks like once it is written down.
 *
 * `voted:{questionId}` is a hash of `userId -> "a:45:21"`, and this is the codec
 * for that value. It lives on the pure side of the seam because two callers now
 * read it and neither should own it: the vote engine, which decodes the
 * viewer's own vote to rebuild their reveal, and the reveal's cameos, which
 * decode ten other people's to know which camp to draw them in.
 *
 * The decoder is deliberately tolerant. A stored value that does not parse
 * returns null rather than throwing, because the alternative is a player locked
 * out of a question forever by one bad row — and a two-field value is not
 * broken, it is a vote cast before points existed.
 */

import type { Choice } from './types.js';

/** What a player's stored vote decodes to. */
export type StoredVote = {
  choice: Choice;
  guess: number;
  /**
   * `|guess - actual|` at the moment of voting, which is what the points were
   * paid on. Absent on votes stored before points existed, and under
   * REPLAY_MODE, where nothing is stored at all.
   */
  error?: number;
};

/** `"a:45"`, and `"a:45:21"` once the vote has been scored. */
export function encodeVote(choice: Choice, guess: number, error?: number): string {
  const head = `${choice}:${guess}`;
  return error === undefined ? head : `${head}:${error}`;
}

export function decodeVote(raw: string | undefined | null): StoredVote | null {
  if (!raw) return null;
  const [choice, guessText, errorText] = raw.split(':');
  if (choice !== 'a' && choice !== 'b') return null;
  const guess = Number(guessText);
  if (!Number.isInteger(guess) || guess < 0 || guess > 100) return null;

  const vote: StoredVote = { choice, guess };
  // A two-field value is an older vote, not a broken one: it still renders, and
  // its award is derived from the live tally instead.
  const error = Number(errorText);
  if (errorText !== undefined && Number.isInteger(error) && error >= 0 && error <= 100) {
    vote.error = error;
  }
  return vote;
}
