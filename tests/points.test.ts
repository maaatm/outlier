import { describe, expect, it } from 'vitest';

import { POINTS_BASE } from '../src/shared/config.js';
import { awardFor, bandFor, BANDS, getBand } from '../src/shared/points.js';

describe('accuracy bands', () => {
  it('pays the tightest band a guess qualifies for', () => {
    expect(bandFor(0).id).toBe('bullseye');
    expect(bandFor(3).id).toBe('sharp');
    expect(bandFor(7).id).toBe('close');
    expect(bandFor(15).id).toBe('warm');
    expect(bandFor(50).id).toBe('cold');
  });

  it('treats every ceiling as inclusive', () => {
    expect(bandFor(2).id).toBe('bullseye');
    expect(bandFor(5).id).toBe('sharp');
    expect(bandFor(10).id).toBe('close');
    expect(bandFor(20).id).toBe('warm');
  });

  it('drops to the next band one point past each ceiling', () => {
    expect(bandFor(3).id).toBe('sharp');
    expect(bandFor(6).id).toBe('close');
    expect(bandFor(11).id).toBe('warm');
    expect(bandFor(21).id).toBe('cold');
  });

  it('catches the widest miss the game can produce', () => {
    // 0 against 100 is the worst available, and it still lands somewhere.
    expect(bandFor(100).id).toBe('cold');
    expect(bandFor(100).bonus).toBe(0);
  });

  it('gets narrower and more generous the further up the table you go', () => {
    for (let i = 1; i < BANDS.length; i++) {
      expect(BANDS[i]!.maxError).toBeGreaterThan(BANDS[i - 1]!.maxError);
      expect(BANDS[i]!.bonus).toBeLessThan(BANDS[i - 1]!.bonus);
    }
  });

  it('looks a band up by id', () => {
    expect(getBand('bullseye').label).toBe('Bullseye');
    expect(getBand('cold').bonus).toBe(0);
  });
});

describe('awarding points', () => {
  it('pays the base rate for showing up, however badly the guess landed', () => {
    expect(awardFor(100).total).toBe(POINTS_BASE);
    expect(awardFor(100).bonus).toBe(0);
    expect(awardFor(100).base).toBe(POINTS_BASE);
  });

  it('adds the band bonus on top of the base', () => {
    expect(awardFor(0)).toEqual({ base: 10, bonus: 50, total: 60, band: 'bullseye' });
    expect(awardFor(4)).toEqual({ base: 10, bonus: 30, total: 40, band: 'sharp' });
    expect(awardFor(9)).toEqual({ base: 10, bonus: 15, total: 25, band: 'close' });
    expect(awardFor(19)).toEqual({ base: 10, bonus: 5, total: 15, band: 'warm' });
    expect(awardFor(40)).toEqual({ base: 10, bonus: 0, total: 10, band: 'cold' });
  });

  it('never pays less for a closer guess', () => {
    for (let error = 1; error <= 100; error++) {
      expect(awardFor(error).total).toBeLessThanOrEqual(awardFor(error - 1).total);
    }
  });
});
