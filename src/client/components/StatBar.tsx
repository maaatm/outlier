/**
 * The three counters in the header: the streak, the points, and the balance.
 *
 * Sun is the only colour used here and it is used nowhere else in the app. It
 * marks the streak alone. The points and coins tiles stay plain — points because
 * a number that only ever goes up is not news, coins because they are spent in
 * the wardrobe rather than read here, and because spending an accent on either
 * would put three meanings of colour on one screen.
 *
 * Three tiles is the most this row can hold. On a narrow phone the day gives up
 * its width first and then disappears entirely — see the header rules in
 * `styles.css` — because it is the one thing here that can be inferred from the
 * question underneath it.
 */

import type { PlayerStats } from '../../shared/types.js';

export function StatBar({ stats }: { stats: PlayerStats }): React.JSX.Element {
  const live = stats.extendedToday && stats.streak > 0;

  return (
    <div className="stats">
      <span
        className={`stat${live ? ' stat--live' : ''}`}
        title={stats.bestStreak > 0 ? `best ${stats.bestStreak}` : undefined}
      >
        streak
        <span className="stat__count">{stats.streak}</span>
      </span>
      <span className="stat">
        points
        <span className="stat__count">{stats.points}</span>
      </span>
      <span className="stat">
        coins
        <span className="stat__count">{stats.coins}</span>
      </span>
    </div>
  );
}
