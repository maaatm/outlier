/**
 * What everyone else guessed. Ten buckets of ten points, with the bucket the
 * player landed in taking the accent.
 *
 * Reads as a tally sheet rather than a chart: flat bars, 2px outlines, no axis
 * furniture beyond the two end labels.
 */

import type { BadgeAccent } from '../../shared/badges.js';
import { HISTOGRAM_BUCKETS } from '../../shared/config.js';

export function Histogram({
  buckets,
  yourGuess,
  accent,
}: {
  buckets: number[];
  yourGuess: number;
  accent: BadgeAccent;
}): React.JSX.Element | null {
  const total = buckets.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;

  const peak = Math.max(...buckets, 1);
  const yourBucket = Math.min(HISTOGRAM_BUCKETS - 1, Math.floor(yourGuess / 10));

  return (
    <div>
      <p className="section__title">where everyone guessed</p>
      <div className="histogram">
        {buckets.map((count, index) => {
          const yours = index === yourBucket;
          return (
            <div
              key={index}
              className={`histogram__bar${yours ? ` histogram__bar--yours is-accent-${accent}` : ''}`}
              style={{ height: `${Math.max(4, (count / peak) * 100)}%` }}
              title={`${index * 10}-${index === HISTOGRAM_BUCKETS - 1 ? 100 : index * 10 + 9}%: ${count}`}
            />
          );
        })}
      </div>
      <div className="histogram__axis">
        <span>0%</span>
        <span>100%</span>
      </div>
    </div>
  );
}
