/**
 * A player's blob: a dot with a face and something breaking its outline.
 *
 * One component and no variants — the same drawing at 18px in the crowd, 24px in
 * front of an author line and 40px in the wardrobe. It *is* a dot with more
 * shape, so it is built the same way one is: flat fill, 2px ink, no gradients.
 *
 * The layers, bottom to top, and why in that order:
 *
 *   1. the accessory, so whatever tucks under the rim is hidden by the head
 *      rather than painted as a white patch on top of it
 *   2. an opaque head, because `--ink-quiet` is a wash and a horn would ghost
 *      straight through it
 *   3. the same head again in `--ink-quiet` with its ink ring, which is exactly
 *      what `.dot` is: that wash over the card colour inside a 2px border
 *   4. the face
 *
 * The element is `size` wide and half again as tall — the accessory lives inside
 * the viewBox rather than overflowing the box, so nothing here needs a scroll
 * container's permission to be seen. See the geometry note in `shared/items.ts`.
 */

import {
  BLOB_CIRCLE,
  VIEW_BOX,
  blobHeight,
  blobStroke,
  resolveAccessory,
  resolveFace,
} from '../../shared/items.js';

type Props = {
  /** Item ids. Unknown, missing or wrong-kind ids fall back to the starter pair. */
  face?: string | undefined;
  accessory?: string | undefined;
  /** The dot's diameter in pixels. The element is 1.5x this tall. */
  size: number;
  /**
   * Announced instead of skipped. A blob next to a name that is already on the
   * screen is decoration, so it is hidden from the reader unless a caller has a
   * reason for it not to be.
   */
  label?: string | undefined;
  /**
   * What fills the head. Defaults to the wash `.dot` uses, which is what makes
   * a blob and a dot the same drawing.
   *
   * The one caller that passes anything else is the reveal's crowd, where a
   * cameo standing in the accented camp has to take the camp's colour — a
   * neutral head in a coloured camp reads as being on the other side. It is
   * still the screen's own accent rather than a colour of the blob's own; a
   * blob does not get to mean anything by being a particular colour.
   */
  fill?: string | undefined;
};

export function Blob({ face, accessory, size, label, fill }: Props): React.JSX.Element {
  const faceItem = resolveFace(face);
  const accessoryItem = resolveAccessory(accessory);

  const stroke = blobStroke(size);
  // The ink sits inside the radius, so `r` stays the outer edge and the drawing
  // occupies exactly `size` pixels however heavy the stroke has to be.
  const radius = BLOB_CIRCLE.r - stroke / 2;

  return (
    <svg
      className="blob"
      width={size}
      height={blobHeight(size)}
      viewBox={VIEW_BOX}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {accessoryItem.path && (
        <path
          d={accessoryItem.path}
          fill="var(--card)"
          stroke="var(--ink)"
          strokeWidth={stroke}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      <circle cx={BLOB_CIRCLE.cx} cy={BLOB_CIRCLE.cy} r={radius} fill="var(--card)" />
      <circle
        cx={BLOB_CIRCLE.cx}
        cy={BLOB_CIRCLE.cy}
        r={radius}
        fill={fill ?? 'var(--ink-quiet)'}
        stroke="var(--ink)"
        strokeWidth={stroke}
      />

      {faceItem.path && <path d={faceItem.path} fill="var(--ink)" />}
    </svg>
  );
}
