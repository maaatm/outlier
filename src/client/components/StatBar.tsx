/**
 * The two counters in the header: the streak and the points.
 *
 * Sun is the only colour used here and it is used nowhere else in the app. It
 * marks the streak alone. The points tile stays plain, because a number that
 * only ever goes up is not news, and spending an accent on it would put three
 * meanings of colour on one screen.
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
    </div>
  );
}
