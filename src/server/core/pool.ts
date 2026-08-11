/**
 * The house pool and its draw order.
 *
 * The pool is shuffled deterministically, so every installation draws the same
 * sequence and a restart never re-rolls it. The cursor walks that sequence, and
 * nothing repeats until the pool is exhausted. On the next pass the seed is
 * mixed with the pass number, so the second lap through 130 questions is not
 * the first lap again.
 */

import pool from '../../../data/questions.json' with { type: 'json' };
import { POOL_SHUFFLE_SEED } from '../../shared/config.js';

export type HouseQuestion = {
  id: string;
  text: string;
  labelA?: string;
  labelB?: string;
};

export const HOUSE_QUESTIONS: HouseQuestion[] = pool.questions;

/** mulberry32. Small, fast, and stable across engines — which is the point. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates against a seeded generator. Same seed, same order, always. */
export function shuffledOrder(items: readonly HouseQuestion[], seed: number): HouseQuestion[] {
  const random = makeRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * The question at a given cursor position. The cursor grows without bound; the
 * pass number falls out of the division, and each pass gets its own order.
 */
export function questionAtCursor(cursor: number): HouseQuestion {
  const size = HOUSE_QUESTIONS.length;
  const pass = Math.floor(cursor / size);
  const index = ((cursor % size) + size) % size;
  const order = shuffledOrder(HOUSE_QUESTIONS, POOL_SHUFFLE_SEED + pass * 0x9e3779b1);
  return order[index]!;
}

export function poolSize(): number {
  return HOUSE_QUESTIONS.length;
}
