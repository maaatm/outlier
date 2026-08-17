/**
 * The counters in the header.
 *
 * They are wells, and that is the whole reason they look the way they do: a
 * number you have already earned is cut into the table, and a number being
 * handed to you sits on a block. The streak and the points are banked, so they
 * are holes in the felt. The `+40` on the score slide is not, so it is a block.
 *
 * Yellow marks the streak alone, and the coin balance in the one room that
 * spends it. Nothing else in the app is yellow except the thing you are about
 * to press.
 *
 * The coin balance is deliberately not in the game's header. It is read in the
 * two places it is relevant — the page of totals, and the wardrobe where it is
 * spent — and a third counter in front of the question is a third thing to read
 * before answering it.
 */

import type { PlayerStats } from '../../shared/types.js';

export function StatBar({ stats }: { stats: PlayerStats }): React.JSX.Element {
  const live = stats.extendedToday && stats.streak > 0;

  return (
    <div className="stats">
      <StatPill
        label="streak"
        value={stats.streak}
        lit={live}
        title={stats.bestStreak > 0 ? `best ${stats.bestStreak}` : undefined}
      />
      <StatPill label="pts" value={stats.points} />
    </div>
  );
}

/**
 * One pill. The menu's rooms carry a single one — points, or the coins the
 * wardrobe is about — rather than the pair the game's header shows, because a
 * room is already about one number and the other is noise in it.
 */
export function StatPill({
  label,
  value,
  lit = false,
  title,
}: {
  label: string;
  value: number;
  /** Yellow rather than cream. The streak when it is alive, and coins. */
  lit?: boolean;
  title?: string | undefined;
}): React.JSX.Element {
  return (
    <span className={`stat well well--pill${lit ? ' stat--live' : ''}`} title={title}>
      <span className="stat__label">{label}</span>
      <span className="stat__count">{value}</span>
    </span>
  );
}
