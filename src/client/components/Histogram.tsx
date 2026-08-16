/**
 * What everyone else guessed. Ten buckets of ten points, with the bucket the
 * player landed in taking the yellow.
 *
 * It is a record of what has already happened rather than anything being
 * awarded, so it lives in a well cut into the felt — and the bars have a bottom
 * face of their own, inset, because a bar in a hole cannot stand proud of it.
 *
 * The bars grow from the floor of the well in sequence and yours arrives last,
 * so the eye is walked across the distribution before it is told where in it
 * you landed.
 */

import { HISTOGRAM_BUCKETS } from '../../shared/config.js';

/** How far apart the bars arrive. Ten of them, so this has to stay small. */
const STEP_MS = 40;

export function Histogram({
  buckets,
  yourGuess,
}: {
  buckets: number[];
  yourGuess: number;
}): React.JSX.Element | null {
  const total = buckets.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;

  const peak = Math.max(...buckets, 1);
  const yourBucket = Math.min(HISTOGRAM_BUCKETS - 1, Math.floor(yourGuess / 10));

  return (
    <div className="histogram__wrap">
      <div className="histogram">
        {buckets.map((count, index) => {
          const yours = index === yourBucket;
          return (
            <div
              key={index}
              className={`histogram__bar${yours ? ' histogram__bar--yours' : ''}`}
              style={{
                height: `${Math.max(4, (count / peak) * 100)}%`,
                animationDelay: `${(yours ? HISTOGRAM_BUCKETS : index) * STEP_MS}ms`,
              }}
              title={`${index * 10}-${index === HISTOGRAM_BUCKETS - 1 ? 100 : index * 10 + 9}%: ${count}`}
            />
          );
        })}
      </div>
      <div className="histogram__axis">
        <span>0</span>
        <span>100</span>
      </div>
    </div>
  );
}
