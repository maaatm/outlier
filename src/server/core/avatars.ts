/**
 * Who is wearing what, what they are allowed to wear, and who is allowed to see
 * it.
 *
 *   avatars                 hash  userId -> "faceId:accessoryId"
 *   inv:{userId}            hash  itemId -> "1"
 *   user:{userId}.showBlob  field "1" | "0", absent meaning on and untold
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
 *
 * `showBlob` is the third thing here and the only one that is about other
 * people. It is read at render time, every time a crowd is drawn, rather than
 * copied onto anything at vote time — which is the whole reason switching it
 * off is retroactive instead of only applying to whatever happens next.
 */

import { redis } from '@devvit/web/server';

import {
  type Equipped,
  STARTER_ACCESSORY,
  STARTER_FACE,
  packAvatar,
  unpackAvatar,
} from '../../shared/items.js';
import { keys, userFields } from './keys.js';

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

/**
 * Whether a blob may be shown to other players, and whether its owner knows.
 *
 * Both answers come off one field, because absent means on *and* untold — see
 * `userFields.showBlob`. Keeping them together means there is one place that
 * knows how to read that field, rather than a default written down twice.
 */
export type BlobVisibility = {
  showBlob: boolean;
  /** They have answered the question at least once, either way. */
  told: boolean;
};

export async function readBlobVisibility(userId: string): Promise<BlobVisibility> {
  return decodeVisibility(await redis.hGet(keys.user(userId), userFields.showBlob));
}

/**
 * Setting it is also the act of having been told, which is why nothing
 * separate records that. The value written is what they chose; the fact that
 * *something* is written is what retires the notice.
 */
export async function setShowBlob(userId: string, showBlob: boolean): Promise<void> {
  await redis.hSet(keys.user(userId), { [userFields.showBlob]: showBlob ? '1' : '0' });
}

/**
 * The same question asked about several players at once.
 *
 * One `hGet` each, in parallel — the preference lives on the player's own hash
 * (it belongs with the rest of their record, and the alternative is a key per
 * player for one character), so there is no `hMGet` to collapse these into. The
 * cost is bounded by `CAMEO_COUNT` and paid on one screen.
 */
export async function readShowBlobFor(userIds: readonly string[]): Promise<boolean[]> {
  return Promise.all(
    userIds.map(async (userId) => (await readBlobVisibility(userId)).showBlob)
  );
}

function decodeVisibility(raw: string | undefined): BlobVisibility {
  const told = raw !== undefined && raw !== '';
  return { showBlob: !told || raw !== '0', told };
}
