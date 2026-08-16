/**
 * The verdict, on an orange block.
 *
 * It used to be a sticker applied by hand, at −2°, scaling and fading in as if
 * somebody had pressed it onto the page. A block does not stamp: it is dropped
 * onto the table, falls the last few pixels and stops. One thud, a beat after
 * the award slides in beside it, and nothing else.
 */

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
      className={`badge block block--orange block--md${animate ? ' is-landing' : ''}`}
      role="status"
    >
      <span className="badge__title">{badge.title}</span>
      <span className="badge__line">{badge.line}</span>
    </div>
  );
}
