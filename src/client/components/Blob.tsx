/**
 * A player's counter: a moulded disc with a face, and something breaking its
 * outline.
 *
 * One component and no variants — the same drawing at 18px in the crowd, 26px
 * on a leaderboard row, 76px on your record and 156px in the wardrobe. It *is*
 * one of the hundred counters, drawn larger, so it is built the same way one
 * is: a flat fill, a darker band inside the bottom edge, no border anywhere.
 *
 * The layers, bottom to top, and why in that order:
 *
 *   1. the accessory — its cast, then its rarity face, then its body — so that
 *      whatever tucks under the rim is hidden by the disc rather than painted
 *      as a slab across it
 *   2. the disc
 *   3. the band inside its bottom edge, which is what makes it a piece with
 *      height rather than a circle
 *   4. the face
 *
 * Every layer but the cast is drawn as one element per subpath. Mirroring a
 * path reverses its winding, so two overlapping halves inside a single `d`
 * cancel under the non-zero fill rule and punch a hole through the overlap —
 * an antenna losing its stalk, a tongue with a notch across it. The cast stays
 * whole for the opposite reason: it is translucent, and one element is what
 * stops the fill doubling where two pieces overlap.
 *
 * The element is `size` wide and half again as tall: the accessory lives inside
 * the viewBox rather than overflowing the box, so nothing here needs a scroll
 * container's permission to be seen. See the geometry note in `counterArt.ts`.
 */

import { BLOB_CIRCLE, VIEW_BOX, blobHeight, resolveAccessory, resolveFace } from '../../shared/items.js';
import {
  CAST_FILL,
  CAST_TRANSFORM,
  DISC_RIM,
  FACE_TRANSFORM,
  paintFor,
  pathFor,
  subpathsFor,
} from '../counterArt.js';

type Props = {
  /** Item ids. Unknown, missing or wrong-kind ids fall back to the starter pair. */
  face?: string | undefined;
  accessory?: string | undefined;
  /** The disc's diameter in pixels. The element is 1.5x this tall. */
  size: number;
  /**
   * Announced instead of skipped. A counter next to a name that is already on
   * the screen is decoration, so it is hidden from the reader unless a caller
   * has a reason for it not to be.
   */
  label?: string | undefined;
  /**
   * What fills the disc. Defaults to the cream every counter in a crowd is.
   *
   * The one caller that passes anything else is the reveal's crowd, where a
   * cameo standing in your camp has to take the camp's colour — a cream piece
   * in an orange camp reads as being on the other side, which is the one thing
   * a cameo must never do.
   */
  fill?: string | undefined;
};

export function Blob({ face, accessory, size, label, fill }: Props): React.JSX.Element {
  const faceItem = resolveFace(face);
  const accessoryItem = resolveAccessory(accessory);
  const paint = paintFor(accessoryItem.rarity);
  const worn = pathFor(accessoryItem.id);
  const pieces = subpathsFor(accessoryItem.id);

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
      {/* The whole accessory's shadow, as one element and before any of it, so
          that two pieces standing close neither cast onto each other nor
          double the fill where they overlap. */}
      {worn && <path d={worn} fill={CAST_FILL} transform={CAST_TRANSFORM} />}

      {/* Rarity lives on the piece's own bottom face: the same drawing dropped
          a few units, with the body painted back over all but its bottom edge. */}
      {pieces.map((d, index) => (
        <path key={index} d={d} fill={paint.face} transform={FACE_TRANSFORM} />
      ))}

      {pieces.map((d, index) => (
        <path key={index} d={d} fill={paint.body} />
      ))}

      <circle
        cx={BLOB_CIRCLE.cx}
        cy={BLOB_CIRCLE.cy}
        r={BLOB_CIRCLE.r}
        fill={fill ?? 'var(--counter)'}
      />
      <path d={DISC_RIM} fill="rgba(0, 0, 0, 0.16)" />

      {subpathsFor(faceItem.id).map((d, index) => (
        <path key={index} d={d} fill="var(--counter-eye)" />
      ))}
    </svg>
  );
}
