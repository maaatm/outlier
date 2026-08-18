/**
 * Push notifications, where they touch Reddit — and the only file in the app
 * that imports the plugin.
 *
 * **Reddit owns the opt-in ledger and we own one field.** `optInCurrentUser`
 * and `isOptedIn` are the record of truth for whether somebody wants this, and
 * a player can presumably turn it off in Reddit's own settings without this app
 * ever hearing about it. So nothing here mirrors that state into Redis: a
 * cached copy of a boolean somebody else can change is a boolean that will
 * eventually lie, and Your record — the one screen that shows it — would be the
 * last to find out. The single thing we do store is `pushAsked`, which is not
 * the answer but the fact that the question was put, and that is ours because
 * Reddit has no opinion about it.
 *
 * **Nothing in this file throws.** Every export wraps its plugin calls and
 * answers with a value that means "no". `@devvit/notifications` ships marked
 * experimental — the API may move, and this app may not be on whatever
 * allowlist gates it — and the failure that matters is not a missing buzz. It
 * is `postDaily` being taken down by a notification, which is why the fan-out
 * lives here and is called *after* the Daily is posted rather than inside
 * `daily.ts`: the `try`/`catch` in `postDaily` releases `daily:claims` on any
 * throw, so a notification failing in there would release the claim on a day
 * whose post already exists. A push is something that happens because the Daily
 * was posted; it is not part of posting it.
 */

import { type EnqueueResponse, notifications, redis } from '@devvit/web/server';
import type { T2, T3 } from '@devvit/web/shared';

import {
  COINS_PROMOTION,
  PUSH_BATCH_SIZE,
  PUSH_ENABLED,
  PUSH_MAX_RECIPIENTS_PER_RUN,
} from '../../shared/config.js';
import { chunk, dailyPushCopy, promotionPushCopy, type PushCopy } from '../../shared/push.js';
import { keys, userFields } from './keys.js';

export type PushState = {
  /** The feature is on and the plugin answered. False hides the switch entirely. */
  available: boolean;
  /** Reddit's answer, or false when unavailable. */
  optedIn: boolean;
  /** They have been put the question. Absent `pushAsked` is false. */
  asked: boolean;
};

/** Off, unavailable, and nothing outstanding. See `readPushState`. */
const OFF: PushState = { available: false, optedIn: false, asked: true };

/**
 * What this player has said, and whether they can be asked at all.
 *
 * With the feature off this reports `asked: true`, which is not a lie about the
 * past so much as a statement about the future: a switch that does not render
 * must not leave a question pending that fires as a surprise the day somebody
 * flips the flag back. Turning the feature on asks the people who have genuinely
 * never been asked, because the field itself is still absent.
 *
 * The two reads go together rather than one after the other — this sits inside
 * the fan-outs in `buildReveal` and `GET /api/avatar`, and neither should gain a
 * round trip for a boolean.
 */
export async function readPushState(userId: string): Promise<PushState> {
  if (!PUSH_ENABLED) return { ...OFF };

  try {
    const [optedIn, asked] = await Promise.all([
      notifications.isOptedIn(userId as T2),
      redis.hGet(keys.user(userId), userFields.pushAsked),
    ]);
    return { available: true, optedIn, asked: asked === '1' };
  } catch (error) {
    // The plugin did not answer, so there is nothing to offer and nothing to
    // report. `asked: true` for the same reason as above — an unavailable
    // feature must not queue up an ask.
    console.error('push: could not read the opt-in state', error);
    return { ...OFF };
  }
}

/**
 * Say yes or no, and record having been asked either way.
 *
 * `pushAsked` is written on **both** answers, for the reason `setShowBlob`
 * retires its notice on either: being asked and saying no is still having been
 * asked, and a notice that only a yes retires is a notice that asks the people
 * who declined it again tomorrow.
 *
 * What comes back is built from the plugin's own `success` rather than from
 * what was requested. This is the one setting in the app whose write can be
 * refused by something that is not us, and a switch that shows what was asked
 * for rather than what happened is a switch that lies the moment it is refused.
 */
export async function setPushOptIn(userId: string, optIn: boolean): Promise<PushState> {
  if (!PUSH_ENABLED) return { ...OFF };

  try {
    const result = optIn
      ? await notifications.optInCurrentUser()
      : await notifications.optOutCurrentUser();

    await markPushAsked(userId);

    if (result.success) return { available: true, optedIn: optIn, asked: true };

    /*
     * Refused, and where that leaves them is a question rather than an
     * inference. It is tempting to answer `!optIn` — a switch is pressed to
     * flip it, so a refused flip leaves it where it was — but the other caller
     * is the one-time ask, whose "No thanks" requests `false` from somebody who
     * is already `false`. Inferring there would report them opted *in* for
     * having declined. So the ledger is re-read, on the one path that needs it.
     */
    console.error(`push: the plugin refused the opt-${optIn ? 'in' : 'out'}`, result.message);
    return {
      available: true,
      optedIn: await notifications.isOptedIn(userId as T2),
      asked: true,
    };
  } catch (error) {
    console.error('push: could not write the opt-in state', error);
    return { ...OFF };
  }
}

/**
 * Record that the question was put, without recording an answer.
 *
 * Its own export because the ask can be answered by a no that never reaches the
 * plugin — and because this is the write that retires the notice, so it has to
 * be the same write from either side.
 */
export async function markPushAsked(userId: string): Promise<void> {
  try {
    await redis.hSet(keys.user(userId), { [userFields.pushAsked]: '1' });
  } catch (error) {
    // The notice fires again tomorrow, which is the right way round for this to
    // break: the alternative is somebody asked once, silently, who never sees
    // the offer again.
    console.error('push: could not record that the ask happened', error);
  }
}

/**
 * Tell everyone who asked to be told that today's question is up.
 *
 * `skipUserId` is what implements the second rule of this feature: the promoted
 * author gets the promotion notice **instead of** this one, not as well as.
 * Both fire from the same `post-daily` run, about the same post, within the same
 * second, and two buzzes about one post is how an opt-in becomes an opt-out.
 *
 * Paged because `enqueue` takes at most `PUSH_BATCH_SIZE` recipients. The walk
 * stops at `PUSH_MAX_RECIPIENTS_PER_RUN` and says how far it got, because a
 * silent truncation reads as "everybody got it" — and a batch that throws is
 * logged and the walk carries on, because one bad page must not cost everybody
 * after it.
 */
export async function broadcastDaily(
  postId: string,
  questionText: string,
  skipUserId?: string
): Promise<void> {
  if (!PUSH_ENABLED) return;

  try {
    const recipients: string[] = [];
    let reachedCap = false;

    for await (const userId of notifications.listOptedInUsersIterator()) {
      if (userId === skipUserId) continue;
      recipients.push(userId);
      if (recipients.length >= PUSH_MAX_RECIPIENTS_PER_RUN) {
        reachedCap = true;
        break;
      }
    }

    if (reachedCap) {
      console.warn(
        `push: stopped the broadcast at ${PUSH_MAX_RECIPIENTS_PER_RUN} recipients — ` +
          'anybody past that was not notified, and the fan-out needs a resumable cursor'
      );
    }

    if (recipients.length === 0) {
      console.log('push: nobody is opted in, nothing broadcast');
      return;
    }

    const copy = dailyPushCopy(questionText);
    let sent = 0;
    let failed = 0;

    for (const batch of chunk(recipients, PUSH_BATCH_SIZE)) {
      try {
        const result = await send(copy, postId, batch);
        sent += result.successCount;
        failed += result.failureCount;
      } catch (error) {
        // The page is lost, the walk is not.
        failed += batch.length;
        console.error(`push: a batch of ${batch.length} failed to enqueue`, error);
      }
    }

    console.log(`push: broadcast ${sent} sent, ${failed} failed, of ${recipients.length}`);
  } catch (error) {
    console.error('push: could not broadcast the Daily', error);
  }
}

/**
 * Tell one author their question took the slot.
 *
 * An empty `authorId` is a no-op rather than an error: a house question has no
 * author, and that is the normal case rather than the edge one — exactly as
 * `creditCoins('', …)` already treats nobody to pay.
 *
 * No `isOptedIn` check in front of it, deliberately and not comfortably. The
 * design is that this notice *replaces* the author's copy of the broadcast, so
 * it assumes an author who is opted in — and whether `enqueue` itself refuses a
 * recipient who is not is Reddit's business and is not established by its type.
 * If it does not, this is the one path in the app that can reach somebody who
 * never said yes, and it should grow the check.
 *
 * The award is read from the constant rather than passed in: it is what
 * `postDaily` paid a moment ago, and a second copy of the number travelling
 * through the task would be a second thing that could disagree with it.
 */
export async function notifyPromotedAuthor(
  authorId: string,
  postId: string,
  questionText: string
): Promise<void> {
  if (!PUSH_ENABLED || !authorId) return;

  try {
    const copy = promotionPushCopy(questionText, COINS_PROMOTION);
    const result = await send(copy, postId, [authorId]);
    console.log(`push: promotion notice ${result.successCount} sent, ${result.failureCount} failed`);
  } catch (error) {
    console.error('push: could not tell the author their question was chosen', error);
  }
}

/**
 * One `enqueue`, with the recipient list built the same way every time.
 *
 * `data: {}` and no templating: every recipient gets the same sentence, and a
 * mustache template with nothing to fill in is a moving part for free.
 */
function send(
  copy: PushCopy,
  postId: string,
  userIds: readonly string[]
): Promise<EnqueueResponse> {
  return notifications.enqueue({
    title: copy.title,
    body: copy.body,
    recipients: userIds.map((userId) => ({
      userId: userId as T2,
      link: postId as T3,
      data: {},
    })),
  });
}
