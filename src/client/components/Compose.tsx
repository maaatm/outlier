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

import { type CommentBlock, commentBlocks, normalizeNote } from '../../shared/comment.js';
import { COINS_COMMENT, NOTE_MAX_LENGTH } from '../../shared/config.js';
import type { Question, Reveal } from '../../shared/types.js';
import { ApiFailure, postComment } from '../api.js';
import { CoinTag } from './CoinTag.js';

type Props = {
  postId: string;
  question: Question;
  reveal: Reveal;
  /**
   * The balance after posting, for the counter in the header.
   *
   * The receipt below is this slide's business, but the header is not — and it
   * is on screen while this pays. The response carries the new balance, so
   * telling the screen above costs nothing but this line.
   */
  onPaid: (coins: number) => void;
};

export function Compose({ postId, question, reveal, onPaid }: Props): React.JSX.Element {
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(reveal.commented);
  // What this post paid, as the server reported it. Zero on a reveal opened
  // again later — the comment was posted on some earlier visit and the coins
  // with it — which is why the receipt below is a branch and not a constant.
  const [earned, setEarned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // The same blocks the server posts, so the preview is the comment.
  const preview = commentBlocks(question, reveal, normalizeNote(note));

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
      onPaid(receipt.coins);
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
            <Preview blocks={preview} />
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
            <div className="label label-row compose__foot">
              <span>posts to the thread</span>
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
          {posting ? (
            'Posting...'
          ) : (
            <>
              {/* What it pays, on the control that pays it — the same tag the
                  ask room's button carries, and the one place the player is
                  deciding whether to post at all. */}
              Post comment<CoinTag coins={COINS_COMMENT} />
            </>
          )}
        </button>
      )}

      {error && <p className="notice notice--quiet notice--spaced">{error}</p>}
    </div>
  );
}

/**
 * The comment, drawn the way the thread will draw it.
 *
 * This used to take the markdown string and split it on `**`, which was a
 * parser — and a parser is exactly what a preview must not be. It printed the
 * footer's `^(...)` markers, which never appear in a thread, and it drew a
 * player's own asterisks as emphasis, which the posted comment no longer does:
 * the note travels as a plain run now, so `**crust**` in the note reaches
 * Reddit as those characters and not as a bold word. Reading the same blocks
 * the server posts is what keeps the two honest, and it is why no markup on
 * this screen has to be recognised at all.
 *
 * Blocks are separated by the blank line `white-space: pre-wrap` renders, which
 * is the paragraph break Reddit puts between them.
 */
function Preview({ blocks }: { blocks: CommentBlock[] }): React.JSX.Element {
  return (
    <>
      {blocks.map((block, blockIndex) => (
        <Fragment key={blockIndex}>
          {blockIndex > 0 && '\n\n'}
          {block.superscript ? (
            <small>{block.runs.map((run) => run.text).join('')}</small>
          ) : (
            block.runs.map((run, index) =>
              run.bold ? (
                <strong key={index}>{run.text}</strong>
              ) : (
                <Fragment key={index}>{run.text}</Fragment>
              )
            )
          )}
        </Fragment>
      ))}
    </>
  );
}
