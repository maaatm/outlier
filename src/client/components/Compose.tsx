/**
 * The share slide. One tap posts the comment.
 *
 * The comment is pre-written and that is load-bearing — nothing here requires
 * the player to type. The note field is optional, is appended to the generated
 * text, and never blocks posting.
 */

import { useLayoutEffect, useRef, useState } from 'react';

import { buildComment, normalizeNote } from '../../shared/comment.js';
import { NOTE_MAX_LENGTH } from '../../shared/config.js';
import type { Question, Reveal } from '../../shared/types.js';
import { ApiFailure, postComment } from '../api.js';

type Props = {
  postId: string;
  question: Question;
  reveal: Reveal;
};

export function Compose({ postId, question, reveal }: Props): React.JSX.Element {
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(reveal.commented);
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
    // scrollHeight leaves out the border, and the box is border-box.
    const border = field.offsetHeight - field.clientHeight;
    field.style.height = `${field.scrollHeight + border}px`;
  }, [note, showNote]);

  async function submit(): Promise<void> {
    setPosting(true);
    setError(null);
    try {
      await postComment(postId, note.trim() || undefined, {
        choice: reveal.choice,
        guess: reveal.guess,
      });
      setPosted(true);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 409) setPosted(true);
      else setError(failure instanceof Error ? failure.message : 'Could not post that.');
    } finally {
      setPosting(false);
    }
  }

  if (posted) {
    return <p className="notice notice--quiet">Posted to the thread.</p>;
  }

  return (
    <div className="compose">
      <div className="compose__body">
        <p className="section__title">your comment, already written</p>
        <pre className="compose__preview">{preview}</pre>

        {showNote && (
          <>
            <label className="visually-hidden" htmlFor="note">
              Optional note
            </label>
            <textarea
              id="note"
              ref={noteRef}
              className="compose__note"
              rows={2}
              maxLength={NOTE_MAX_LENGTH}
              value={note}
              placeholder="Add a line, or do not."
              onChange={(event) => setNote(event.target.value)}
            />
            <p className="compose__hint">{NOTE_MAX_LENGTH - note.length} left. Skippable.</p>
          </>
        )}
      </div>

      <div className="compose__actions">
        {!showNote && (
          <button type="button" className="button button--quiet" onClick={() => setShowNote(true)}>
            Add a line (optional)
          </button>
        )}

        <button
          type="button"
          className="button button--primary"
          onClick={submit}
          disabled={posting}
        >
          {posting ? 'Posting...' : 'Post this to the thread'}
        </button>

        {error && <p className="notice notice--quiet">{error}</p>}
      </div>
    </div>
  );
}
