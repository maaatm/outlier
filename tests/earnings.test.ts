import { describe, expect, it } from 'vitest';

import {
  EARN_COPY,
  type EarnReason,
  type Earning,
  decodeEarning,
  encodeEarning,
} from '../src/shared/earnings.js';

const REASONS = Object.keys(EARN_COPY) as EarnReason[];

const earning = (over: Partial<Earning> = {}): Earning => ({
  reason: 'upvotes',
  coins: 8,
  at: 1_739_000_000_000,
  detail: 12,
  ...over,
});

describe('the ledger codec', () => {
  it('round-trips every reason there is', () => {
    for (const reason of REASONS) {
      const entry = earning({ reason });
      expect(decodeEarning(encodeEarning(entry))).toEqual(entry);
    }
  });

  it('writes the timestamp first, so members sort and stay unique', () => {
    const entry = earning();
    expect(encodeEarning(entry).startsWith(`${entry.at}:`)).toBe(true);
    // Two earnings of the same reason a millisecond apart are different rows.
    expect(encodeEarning(entry)).not.toBe(encodeEarning(earning({ at: entry.at + 1 })));
  });

  it('keeps the free roll, which pays nothing in coins', () => {
    const entry = earning({ reason: 'join', coins: 0, detail: 0 });
    expect(decodeEarning(encodeEarning(entry))).toEqual(entry);
  });

  /*
   * The decoder is deliberately tolerant, the way `decodeVote` is: a row it
   * cannot read is skipped and the other seven still render. Every one of these
   * must answer null rather than throw.
   */
  it('answers null on anything it cannot read, rather than throwing', () => {
    const bad = [
      '',
      'nonsense',
      '1739000000000:bribe:5:0', // not a reason
      '1739000000000:daily:5', // a field short
      'later:daily:5:0', // no timestamp
      '0:daily:5:0', // no timestamp that means anything
      '1739000000000:daily:five:0', // coins that are not a number
      '1739000000000:daily:-5:0', // nothing is ever taken back
      '1739000000000:daily:5.5:0', // coins are whole things
      '1739000000000:upvotes:5:-1', // a count below nothing
    ];

    for (const raw of bad) expect(decodeEarning(raw)).toBeNull();
    expect(decodeEarning(undefined)).toBeNull();
    expect(decodeEarning(null)).toBeNull();
  });
});

describe('what each line says', () => {
  it('has words for every reason, and never an empty line', () => {
    for (const reason of REASONS) {
      expect(EARN_COPY[reason](7).length).toBeGreaterThan(0);
    }
  });

  it('counts one upvote as an upvote', () => {
    expect(EARN_COPY.upvotes(1)).toContain('1 upvote');
    expect(EARN_COPY.upvotes(1)).not.toContain('upvotes');
    expect(EARN_COPY.upvotes(8)).toContain('8 upvotes');
  });

  it('says what you did rather than what the ledger recorded', () => {
    // The test of the tone: no line names a constant, a field or a payout.
    for (const reason of REASONS) {
      const line = EARN_COPY[reason](100);
      expect(line).toBe(line.toLowerCase().replace('daily', 'Daily'));
      expect(line).not.toMatch(/COIN|BONUS|_/);
    }
  });
});
