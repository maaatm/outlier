/**
 * The share slide. One tap posts the comment.
 *
 * The comment is pre-written and that is load-bearing — nothing here requires
 * the player to type. The note field is optional, is appended to the generated
 * text, and never blocks posting.
 *
 * Both fields are wells cut into the cream block. That is the rule the whole
 * design runs on and this is where it is easiest to see: a well cut into the
 * felt is inert and holds a number you have earned; a well cut into a block
 * takes text.
 */

import { Fragment, useLayoutEffect, useRef, useState } from 'react';

import { buildComment, normalizeNote } from '../../shared/comment.js';
import { COINS_COMMENT, NOTE_MAX_LENGTH } from '../../shared/config.js';
import type { Question, Reveal } from '../../shared/types.js';
import { ApiFailure, postComment } from '../api.js';

type Props = {
  postId: string;
  question: Question;
  reveal: Reveal;
};

export function Compose({ postId, question, reveal }: Props): React.JSX.Element {
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(reveal.commented);
  // What this post paid, as the server reported it. Zero on a reveal opened
  // again later — the comment was posted on some earlier visit and the coins
  // with it — which is why the receipt below is a branch and not a constant.
  const [earned, setEarned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // The same function the server uses, so the preview is the comment.
  const preview = buildComment(question, reveal, normalizeNote(note));

  // The note field takes the height of its own text, so a line that wraps
  // stretches the box down instead of scrolling inside it. Done before paint so
  // the field is never briefly the wrong height under the cursor.
  useLayoutEffect(() => {
    const field = noteRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }, [note, posted]);

  async function submit(): Promise<void> {
    setPosting(true);
    setError(null);
    try {
      const receipt = await postComment(postId, note.trim() || undefined, {
        choice: reveal.choice,
        guess: reveal.guess,
      });
      setEarned(receipt.earned);
      setPosted(true);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 409) setPosted(true);
      else setError(failure instanceof Error ? failure.message : 'That did not post.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="compose">
      <div className="compose__card block block--cream block--lg">
        <span className="label">your comment</span>

        {/*
          Posting fills this well with one line of confirmation, in place. The
          room does not grow and nothing moves: the block under it went flat,
          which is the whole receipt.
        */}
        <p className="compose__preview well--cut">
          {posted ? (
            // The payout goes in the sentence that was already there rather than
            // in a block of its own: the well is filled, the button below has
            // gone, and the whole receipt is one line longer than it was.
            earned > 0 ? `Posted to the thread. +${earned} coins.` : 'Posted to the thread.'
          ) : (
            <Bolded text={preview} />
          )}
        </p>

        {!posted && (
          <>
            <label className="label compose__label" htmlFor="note">
              add a line (optional)
            </label>
            <textarea
              id="note"
              ref={noteRef}
              className="compose__note well--cut"
              rows={2}
              maxLength={NOTE_MAX_LENGTH}
              value={note}
              placeholder="Anything you want to add."
              onChange={(event) => setNote(event.target.value)}
            />
            {/* The one place the player is deciding whether to post, so it is
                the one place worth saying what posting pays. It costs no
                layout: the row was already there, carrying a line that said
                what the orange button underneath it says. */}
            <div className="label label-row compose__foot">
              <span>+{COINS_COMMENT} coins</span>
              <span>
                {note.length} / {NOTE_MAX_LENGTH}
              </span>
            </div>
          </>
        )}
      </div>

      {!posted && (
        <button
          type="button"
          className="button block block--orange block--lg compose__post"
          onClick={submit}
          disabled={posting}
        >
          {posting ? 'Posting...' : 'Post comment'}
        </button>
      )}

      {error && <p className="notice notice--quiet notice--spaced">{error}</p>}
    </div>
  );
}

/**
 * The comment, with its bold runs drawn bold.
 *
 * `buildComment` writes Reddit markdown, so the side taken and the badge come
 * out wrapped in asterisks — and asterisks in a preview are the one thing on
 * this screen that would not appear in the thread. Rendering the runs instead
 * of printing the markers is what makes this a preview rather than a copy of
 * the source. The text itself is untouched: what gets posted is still the
 * string the server builds, byte for byte.
 */
function Bolded({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {text.split('**').map((run, index) =>
        index % 2 === 1 ? <strong key={index}>{run}</strong> : <Fragment key={index}>{run}</Fragment>
      )}
    </>
  );
}
