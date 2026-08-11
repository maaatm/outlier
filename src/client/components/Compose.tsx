/**
 * One tap posts the comment.
 *
 * The comment is pre-written and that is load-bearing — the primary button
 * posts it directly, no typing anywhere. "See it first" opens an overlay panel
 * with the exact text and the optional note; the panel floats over the reveal
 * instead of extending it, so the screen never grows past the viewport.
 */

import { useState } from 'react';

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
  const [panel, setPanel] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(reveal.commented);
  const [error, setError] = useState<string | null>(null);

  // The same function the server uses, so the preview is the comment.
  const preview = buildComment(question, reveal, normalizeNote(note));

  async function submit(): Promise<void> {
    setPosting(true);
    setError(null);
    try {
      await postComment(postId, note.trim() || undefined);
      setPosted(true);
      setPanel(false);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 409) {
        setPosted(true);
        setPanel(false);
      } else {
        setError(failure instanceof Error ? failure.message : 'Could not post that.');
      }
    } finally {
      setPosting(false);
    }
  }

  if (posted) {
    return <p className="notice notice--quiet">Posted to the thread.</p>;
  }

  return (
    <div className="compose">
      <div className="compose__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={submit}
          disabled={posting}
        >
          {posting ? 'Posting...' : 'Post this to the thread'}
        </button>
        <button type="button" className="button button--quiet" onClick={() => setPanel(true)}>
          See it · add a line
        </button>
      </div>

      {error && !panel && <p className="notice notice--quiet">{error}</p>}

      {panel && (
        <div className="compose__panel" role="dialog" aria-label="Your comment">
          <p className="section__title">your comment, already written</p>
          <pre className="compose__preview">{preview}</pre>

          <label className="visually-hidden" htmlFor="note">
            Optional note
          </label>
          <textarea
            id="note"
            className="compose__note"
            rows={2}
            maxLength={NOTE_MAX_LENGTH}
            value={note}
            placeholder="Add a line, or do not."
            onChange={(event) => setNote(event.target.value)}
          />
          <p className="compose__hint">{NOTE_MAX_LENGTH - note.length} left. Skippable.</p>

          <div className="compose__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={submit}
              disabled={posting}
            >
              {posting ? 'Posting...' : 'Post it'}
            </button>
            <button type="button" className="button button--quiet" onClick={() => setPanel(false)}>
              Back
            </button>
          </div>

          {error && <p className="notice notice--quiet">{error}</p>}
        </div>
      )}
    </div>
  );
}
