/**
 * A player's counter: a moulded disc with a face, and something breaking its
 * outline.
 *
 * One component and no variants — the same drawing at 18px in the crowd, 28px
 * on a leaderboard row, 76px on your record and 172px in the wardrobe. It *is*
 * one of the hundred counters, drawn larger, so it is built the same way one
 * is: a flat fill, a darker band inside the bottom edge, no border anywhere.
 *
 * The layers, bottom to top, and why in that order:
 *
 *   1. the accessory, as blocks, so whatever tucks under the rim is hidden by
 *      the disc rather than painted as a slab across it
 *   2. the disc
 *   3. the band inside its bottom edge, which is what makes it a piece with
 *      height rather than a circle
 *   4. the face
 *
 * The element is `size` wide and half again as tall: the accessory lives inside
 * the viewBox rather than overflowing the box, so nothing here needs a scroll
 * container's permission to be seen. See the geometry note in `counterArt.ts`.
 */

import { BLOB_CIRCLE, VIEW_BOX, blobHeight, resolveAccessory, resolveFace } from '../../shared/items.js';
import { DISC_RIM, blockFace, blockSpin, blocksFor, paintFor } from '../counterArt.js';

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
      {blocksFor(accessoryItem.id).map((block, index) => (
        <g key={index} transform={blockSpin(block)}>
          <rect
            x={block.x}
            y={block.y}
            width={block.w}
            height={block.h}
            rx={block.r}
            fill={paint.body}
          />
          {/* Rarity lives on the piece's own bottom face. */}
          <path d={blockFace(block)} fill={paint.face} />
        </g>
      ))}

      <circle
        cx={BLOB_CIRCLE.cx}
        cy={BLOB_CIRCLE.cy}
        r={BLOB_CIRCLE.r}
        fill={fill ?? 'var(--counter)'}
      />
      <path d={DISC_RIM} fill="rgba(0, 0, 0, 0.16)" />

      {faceItem.path && <path d={faceItem.path} fill="var(--counter-eye)" />}
    </svg>
  );
}
