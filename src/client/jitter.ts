/**
 * Deliberate imperfection, seeded.
 *
 * A perfect CSS grid of circles reads as machine output. Every offset here is
 * derived from the counter's index, so the scatter is stable across renders and
 * across reloads — the crowd looks tipped out, not randomised on each paint.
 *
 * One move now, where there used to be three. The wobbled rule and the tilted
 * badge went with the flat sticker-book they belonged to: in Blocks every piece
 * is square to the screen and the counters are the only thing that leans, which
 * is what makes the lean read as pieces on a table rather than as a house
 * style. `counterArt.ts` opens `rotation` up from ±3° to the ±14° a tipped
 * counter wants, and this stays the one place the crowd's imperfection is
 * seeded.
 */

/** Deterministic hash of an integer to [0, 1). */
export function hashUnit(index: number, salt: number): number {
  let h = (index + 1) * 0x9e3779b1 + salt * 0x85ebca6b;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** [-1, 1) from the same hash. */
function hashSigned(index: number, salt: number): number {
  return hashUnit(index, salt) * 2 - 1;
}

export type Jitter = {
  /** ±2px, applied to the resting position. */
  dx: number;
  dy: number;
  /** ±3°. */
  rotation: number;
};

export function jitterFor(index: number): Jitter {
  return {
    dx: hashSigned(index, 1) * 2,
    dy: hashSigned(index, 2) * 2,
    rotation: hashSigned(index, 3) * 3,
  };
}

/**
 * Where a dot sits before the reveal: a loose neutral scatter across the box.
 * It carries no information about the split — the crowd is undifferentiated
 * until a vote is locked in.
 *
 * Offsets are taken from a coarse grid rather than drawn freely across the box.
 * Free placement piles four dots on one spot and leaves holes elsewhere, which
 * reads as a smudge; a grid loosened by most of a cell reads as a crowd milling
 * about, which is what it is.
 */
export function scatterFor(
  index: number,
  columns: number,
  cell: number,
  spread = 0.45
): { x: number; y: number } {
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: column * cell + hashSigned(index, 11) * cell * spread,
    y: row * cell + hashSigned(index, 12) * cell * spread,
  };
}

/**
 * The handful of counters that get faces. A crowd where every face is drawn
 * looks like a mascot sheet; a crowd where a few surface looks alive.
 *
 * The strip on the score and share slides asks for the same treatment at the
 * same rate, so the pieces that stood with you are recognisably the same pieces
 * one slide later.
 */
export function facedDots(count: number, crowdSize: number, salt = 7): Set<number> {
  const picked = new Set<number>();
  let cursor = 0;
  // Walk deterministically rather than sampling, so the same faces appear every time.
  while (picked.size < count && cursor < crowdSize * 4) {
    picked.add(Math.floor(hashUnit(cursor, salt) * crowdSize));
    cursor++;
  }
  return picked;
}
