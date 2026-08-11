/**
 * Deliberate imperfection, seeded.
 *
 * A perfect CSS grid of circles reads as machine output. Every offset here is
 * derived from the dot's index, so the scatter is stable across renders and
 * across reloads — the crowd looks drawn, not randomised on each paint.
 *
 * Three moves, and only three: jitter the crowd, wobble the rule, tilt the
 * badge. A fourth becomes a gimmick.
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
 * The handful of dots that get faces. A crowd where every face is drawn looks
 * like a mascot sheet; a crowd where a few surface looks alive.
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

/**
 * The wobbled divider. An `<hr>` is a machine line; this is a path with a slight
 * hand-drawn waver, seeded so it does not shimmer between renders.
 */
export function wobblePath(width: number, salt = 5): string {
  const segments = 8;
  const step = width / segments;
  const points: string[] = [`M 0 ${(4 + hashSigned(0, salt) * 1.2).toFixed(2)}`];

  for (let i = 1; i <= segments; i++) {
    const x = step * i;
    const y = 4 + hashSigned(i, salt) * 1.6;
    const cx = x - step / 2;
    const cy = 4 + hashSigned(i, salt + 1) * 2.2;
    points.push(`Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return points.join(' ');
}
