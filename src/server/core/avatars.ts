/**
 * Who is wearing what, and what they are allowed to wear.
 *
 *   avatars       hash  userId -> "faceId:accessoryId"
 *   inv:{userId}  hash  itemId -> "1"
 *
 * The shape of the first key is the point of it. One shared hash with the pair
 * packed into one field means a screen that needs ten blobs costs one `hMGet`,
 * not ten round trips — which is what makes putting other players' blobs on the
 * reveal affordable at all, on a screen already doing three reads.
 *
 * `inv:` now gates. Prompt 03 shipped it unlocked and wrote to it anyway, so
 * that turning the economy on would be a change to one rule rather than a
 * back-fill across a population who had been equipping freely. The rule itself
 * is `ownsItem` in `shared/items.ts`, pure and shared with the client, so the
 * wardrobe cannot offer something the equip endpoint will refuse.
 */

import { redis } from '@devvit/web/server';

import {
  type Equipped,
  STARTER_ACCESSORY,
  STARTER_FACE,
  packAvatar,
  unpackAvatar,
} from '../../shared/items.js';
import { keys } from './keys.js';

/** No entry is not an error: it is a player who has never opened the wardrobe. */
export async function readAvatar(userId: string): Promise<Equipped> {
  return unpackAvatar(await redis.hGet(keys.avatars, userId));
}

/**
 * Everything this player owns, starters included.
 *
 * The starters are added on the way out rather than stored, so a fresh player
 * has no `inv:` key at all and still owns the pair they are wearing.
 *
 * **The migration.** While the catalogue was unlocked anyone could equip
 * anything, and the moment ownership started being enforced they would have been
 * holding something they did not own — and been reset to the starter blob by the
 * next read. So whatever is currently equipped is granted here, once, on the
 * first read after this change. It matters only on the dev subreddit, and the
 * alternative is a confusing bug report.
 */
export async function readInventory(userId: string): Promise<string[]> {
  const [raw, equipped] = await Promise.all([
    redis.hGetAll(keys.inventory(userId)),
    readAvatar(userId),
  ]);

  const owned = new Set([STARTER_FACE.id, STARTER_ACCESSORY.id, ...Object.keys(raw ?? {})]);

  const granted = [equipped.face, equipped.accessory].filter((id) => !owned.has(id));
  if (granted.length > 0) {
    await redis.hSet(keys.inventory(userId), Object.fromEntries(granted.map((id) => [id, '1'])));
    for (const id of granted) owned.add(id);
  }

  return [...owned];
}

/**
 * Put a pair on.
 *
 * Equipping no longer grants. It did while nothing was locked, so that there
 * would be an inventory to enforce against later; now that there is one, a
 * write that grants what you just put on would be a way to own things by wearing
 * them. Ownership comes from the gift box, and from the migration above.
 */
export async function equipAvatar(userId: string, equipped: Equipped): Promise<void> {
  await redis.hSet(keys.avatars, { [userId]: packAvatar(equipped) });
}
