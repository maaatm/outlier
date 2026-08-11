/** The result badge. Sits at −2°, like a stamp applied by hand. */

import { getBadge, type BadgeId } from '../../shared/badges.js';

export function BadgeStamp({
  id,
  animate,
}: {
  id: BadgeId;
  animate: boolean;
}): React.JSX.Element {
  const badge = getBadge(id);

  return (
    <div
      className={`badge badge--${badge.accent}${animate ? ' is-stamping' : ''}`}
      role="status"
    >
      <p className="badge__title">{badge.title}</p>
      <p className="badge__line">{badge.line}</p>
    </div>
  );
}
