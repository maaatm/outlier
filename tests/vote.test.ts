import { describe, expect, it } from 'vitest';

import { decodeVote, encodeVote } from '../src/shared/vote.js';

/*
 * The codec moved onto the pure side when the reveal's cameos started reading
 * it: a cameo's camp is decided by decoding somebody else's stored vote, so a
 * decoder that got it wrong would put a real person on the wrong side of a real
 * question. That is worth more than the two tests it costs.
 */
describe('the stored vote', () => {
  it('survives a round trip, scored or not', () => {
    expect(decodeVote(encodeVote('a', 45))).toEqual({ choice: 'a', guess: 45 });
    expect(decodeVote(encodeVote('b', 0, 21))).toEqual({ choice: 'b', guess: 0, error: 21 });
  });

  it('reads a two-field value as a vote from before points existed', () => {
    expect(decodeVote('a:45')).toEqual({ choice: 'a', guess: 45 });
  });

  it('refuses anything that is not one of the two sides', () => {
    expect(decodeVote('c:45:1')).toBeNull();
    expect(decodeVote('')).toBeNull();
    expect(decodeVote(undefined)).toBeNull();
    expect(decodeVote(null)).toBeNull();
  });

  it('refuses a guess that is not a whole percentage', () => {
    expect(decodeVote('a:101')).toBeNull();
    expect(decodeVote('a:-1')).toBeNull();
    expect(decodeVote('a:45.5')).toBeNull();
    expect(decodeVote('a:nope')).toBeNull();
  });

  it('keeps the vote when only the banked error is unreadable', () => {
    // The award falls back to the live tally; the answer itself is still good,
    // and throwing it away would lock a player out of their own reveal.
    expect(decodeVote('a:45:oops')).toEqual({ choice: 'a', guess: 45 });
  });
});
