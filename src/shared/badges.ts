/**
 * The 2x2. Two independent axes — whether you were in the minority, and whether
 * you read the room — give four outcomes.
 *
 * All player-facing badge copy lives in this one map so the tone can be tuned
 * without touching a line of logic. The voice is dry and observational: it
 * reports what happened, it does not congratulate.
 */

export type BadgeId = 'baseline' | 'impostor' | 'selfAware' | 'bubble';

/** Which accent the badge and the crowd take. One meaning per color. */
export type BadgeAccent = 'signal' | 'rare' | 'hit';

export type Badge = {
  id: BadgeId;
  /** Shown on the stamp. */
  title: string;
  /** One line under the title. */
  line: string;
  accent: BadgeAccent;
};

export const BADGES: Record<BadgeId, Badge> = {
  baseline: {
    id: 'baseline',
    title: 'Baseline',
    line: 'You went with the room and you knew it.',
    accent: 'hit',
  },
  impostor: {
    id: 'impostor',
    title: 'Impostor syndrome',
    line: 'You went with the room and thought you were alone.',
    accent: 'signal',
  },
  selfAware: {
    id: 'selfAware',
    title: 'Self-aware outlier',
    line: 'You went against the room and saw it coming.',
    accent: 'hit',
  },
  bubble: {
    id: 'bubble',
    title: 'Living in a bubble',
    line: 'You went against the room and had no idea.',
    accent: 'rare',
  },
};

/** The 2x2 itself. Minority on one axis, read-the-room on the other. */
export function badgeFor(minority: boolean, hit: boolean): BadgeId {
  if (minority) return hit ? 'selfAware' : 'bubble';
  return hit ? 'baseline' : 'impostor';
}

export function getBadge(id: BadgeId): Badge {
  return BADGES[id];
}
