/**
 * Who is wearing what.
 *
 *   avatars       hash  userId -> "faceId:accessoryId"
 *   inv:{userId}  hash  itemId -> "1"
 *
 * The shape of the first key is the point of it. One shared hash with the pair
 * packed into one field means a screen that needs ten blobs costs one `hMGet`,
 * not ten round trips — which is what makes putting other players' blobs on the
 * reveal affordable at all, on a screen already doing three reads.
 *
 * `inv:` is written here and gates nothing yet: every item is unlocked in this
 * change. It is written anyway because the next change puts items behind coins,
 * and back-filling an inventory for a population who have been equipping freely
 * is worse than writing one now.
 */

import { redis } from '@devvit/web/server';

import {
  type Equipped,
  type Item,
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
 */
export async function readInventory(userId: string): Promise<string[]> {
  const raw = await redis.hGetAll(keys.inventory(userId));
  const owned = new Set([STARTER_FACE.id, STARTER_ACCESSORY.id, ...Object.keys(raw ?? {})]);
  return [...owned];
}

/**
 * Put a pair on, and record that this player has them.
 *
 * The grant is redundant today — nothing checks ownership — but it is the write
 * that makes `ownsItem` mean something the moment it stops returning true.
 */
export async function equipAvatar(userId: string, equipped: Equipped): Promise<void> {
  const granted = [equipped.face, equipped.accessory].filter(
    (id) => id !== STARTER_FACE.id && id !== STARTER_ACCESSORY.id
  );

  await Promise.all([
    redis.hSet(keys.avatars, { [userId]: packAvatar(equipped) }),
    granted.length > 0
      ? redis.hSet(keys.inventory(userId), Object.fromEntries(granted.map((id) => [id, '1'])))
      : Promise.resolve(),
  ]);
}

/**
 * Whether a player may wear an item. True for everything, on purpose.
 *
 * Nothing is locked in this change — the point of shipping the catalogue before
 * the economy is to prove the art reads at every size before any of it is behind
 * a reward loop. The check exists anyway so that turning the economy on is a
 * change to this one function rather than a hunt for the call sites that should
 * have had it. An inventory the client can bypass is decoration.
 */
export async function ownsItem(_userId: string, _item: Item): Promise<boolean> {
  return true;
}
