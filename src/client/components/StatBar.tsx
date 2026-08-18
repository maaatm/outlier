/**
 * The counters in the header.
 *
 * They are wells, and that is the whole reason they look the way they do: a
 * number you have already earned is cut into the table, and a number being
 * handed to you sits on a block. The streak, the coins and the points are all
 * banked, so all three are holes in the felt. The `+40` on the score slide is
 * not, so it is a block.
 *
 * Three of them, in the order a day pays them out: the streak, the coins the
 * streak pays, the points the question pays. Colour is what separates them and
 * every colour means one thing — yellow is the streak alone, and only while it
 * is alive; orange is coins, here and in every other place they are counted;
 * points take no accent at all, which is what leaves the other two legible.
 */

import type { PlayerStats } from '../../shared/types.js';

export function StatBar({ stats }: { stats: PlayerStats }): React.JSX.Element {
  const live = stats.extendedToday && stats.streak > 0;

  return (
    <div className="stats">
      <StatPill
        label="streak"
        value={stats.streak}
        tone={live ? 'live' : undefined}
        title={stats.bestStreak > 0 ? `best ${stats.bestStreak}` : undefined}
      />
      {/* Between the two rather than beside them: coins are paid by the streak
          on the left and spent nowhere the points on the right can see, and a
          balance at the end of the row would read as the score. */}
      <StatPill label="coins" value={stats.coins} tone="coins" />
      <StatPill label="pts" value={stats.points} />
    </div>
  );
}

/** Yellow is the live streak, orange is a coin balance. Nothing else is lit. */
type Tone = 'live' | 'coins';

/**
 * One pill. The menu's rooms carry a single one — the coins the wardrobe is
 * about, or points — rather than the three the header shows, because a room is
 * already about one number and the others are noise in it.
 */
export function StatPill({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: number;
  tone?: Tone | undefined;
  title?: string | undefined;
}): React.JSX.Element {
  return (
    <span className={`stat well well--pill${tone ? ` stat--${tone}` : ''}`} title={title}>
      <span className="stat__label">{label}</span>
      <span className="stat__count">{value}</span>
    </span>
  );
}
