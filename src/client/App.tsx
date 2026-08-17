/**
 * See question → tap an answer → drag the slider → lock in → reveal.
 *
 * Two taps, no typing, under fifteen seconds. Everything on the way to the
 * reveal is instant; the reveal is the one orchestrated moment.
 */

import { context } from '@devvit/web/client';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { CROWD_SIZE } from '../shared/config.js';
import type { Equipped } from '../shared/items.js';
import { getBand, type Award } from '../shared/points.js';
import type { Choice, Question, QuestionState, Reveal, StateResponse } from '../shared/types.js';
import { ApiFailure, castVote, fetchState, saveShowBlob } from './api.js';
import { Blob } from './components/Blob.js';
import { Compose } from './components/Compose.js';
import { DotCrowd } from './components/DotCrowd.js';
import { Histogram } from './components/Histogram.js';
import { Menu } from './components/Menu.js';
import { StatBar } from './components/StatBar.js';
import { Wordmark } from './components/Wordmark.js';
import { COUNTER_SIZE } from './counterArt.js';
import { useCountUp } from './countUp.js';
import { WORDMARK_SIZE } from './wordmarkArt.js';

const DEFAULT_GUESS = 50;

type Phase =
  | { name: 'loading' }
  | { name: 'error'; message: string }
  | { name: 'ready'; state: StateResponse };

/** The question and the menu are the two screens. Only one is ever mounted. */
type Screen = 'game' | 'menu';

export function App(): React.JSX.Element {
  const postId = context.postId;
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  // The reveal is orchestrated only for the vote that produced it. A player
  // reopening a post they already answered lands on the finished state.
  const [justVoted, setJustVoted] = useState(false);
  const [screen, setScreen] = useState<Screen>('game');
  // The reveal's page index lives up here rather than inside the reveal, so a
  // trip to the menu and back returns to the slide it was opened from.
  const [slide, setSlide] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    if (!postId) {
      setPhase({ name: 'error', message: 'This post has no question attached.' });
      return;
    }
    try {
      setPhase({ name: 'ready', state: await fetchState(postId) });
    } catch (failure) {
      setPhase({
        name: 'error',
        message: failure instanceof Error ? failure.message : 'Could not load the question.',
      });
    }
  }, [postId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase.name === 'loading') {
    return (
      <main className="app">
        <p className="notice notice--quiet">Loading.</p>
      </main>
    );
  }

  if (phase.name === 'error') {
    return (
      <main className="app">
        <p className="notice">{phase.message}</p>
      </main>
    );
  }

  // Bound once so the narrowing below survives into the callback: TypeScript
  // drops a discriminant it proved on a property path as soon as it crosses into
  // a closure, but it keeps one proved on a const.
  const state = phase.state;

  // The pinned menu post has no question behind it, so the menu is the whole
  // screen and there is nothing to exit to.
  if (state.kind === 'menu') {
    return <Menu stats={state.stats} postId={postId} canSubmit={state.canSubmit} />;
  }

  if (screen === 'menu') {
    return (
      <Menu
        stats={state.stats}
        postId={postId}
        canSubmit={state.canSubmit}
        onExit={() => setScreen('game')}
      />
    );
  }

  return (
    <Game
      postId={postId!}
      state={state}
      justVoted={justVoted}
      slide={slide}
      onSlide={setSlide}
      onOpenMenu={() => setScreen('menu')}
      onReveal={(reveal) => {
        setJustVoted(true);
        setPhase({ name: 'ready', state: { ...state, reveal, stats: reveal.stats } });
      }}
      // Held here rather than inside the notice, which unmounts on the way to
      // the next slide and on the way out to the menu — and a first-run notice
      // that comes back is not one.
      onBlobNoticed={() => {
        if (!state.reveal) return;
        setPhase({
          name: 'ready',
          state: { ...state, reveal: { ...state.reveal, blobNotice: false } },
        });
      }}
    />
  );
}

function Game({
  postId,
  state,
  justVoted,
  slide,
  onSlide,
  onOpenMenu,
  onReveal,
  onBlobNoticed,
}: {
  postId: string;
  state: QuestionState;
  justVoted: boolean;
  slide: number;
  onSlide: (slide: number) => void;
  onOpenMenu: () => void;
  onReveal: (reveal: Reveal) => void;
  onBlobNoticed: () => void;
}): React.JSX.Element {
  const { question, reveal, stats, canVote, authorAvatar } = state;

  // The felt is the page. There is no card between the header and the table,
  // which is what the whole screen is now — blocks placed on green.
  return (
    <main className="app">
      <header className="header">
        <Wordmark size={WORDMARK_SIZE.header} />
        <StatBar stats={stats} />
      </header>

      {reveal ? (
        <RevealView
          postId={postId}
          question={question}
          reveal={reveal}
          animate={justVoted}
          slide={slide}
          onSlide={onSlide}
          onOpenMenu={onOpenMenu}
          onBlobNoticed={onBlobNoticed}
        />
      ) : (
        <PlayView
          postId={postId}
          question={question}
          avatar={authorAvatar}
          canVote={canVote}
          locked={question.locked}
          onReveal={onReveal}
        />
      )}
    </main>
  );
}

/**
 * The question, full size, on the cream block it is asked from.
 *
 * The block's bottom face is the separator that the hand-drawn rule under the
 * question used to be — one of the three deliberate imperfections the old UI
 * had, and the only one this design keeps no version of. Depth does that job
 * now, everywhere, so a second device for it would be a second idiom.
 */
function QuestionCard({
  question,
  avatar,
}: {
  question: Question;
  avatar: Equipped | null;
}): React.JSX.Element {
  return (
    <div className="question-block block block--cream block--md">
      {question.source === 'community' && question.authorName && (
        <Byline name={question.authorName} avatar={avatar} />
      )}
      <span className="label">
        {question.isDaily && question.dailyDate
          ? `daily · ${formatDay(question.dailyDate)}`
          : question.isDaily
            ? 'daily'
            : 'open question'}
      </span>
      <h1 className="question">{question.text}</h1>
    </div>
  );
}

/**
 * The same question once it has been answered, compressed to a strip.
 *
 * It stays there for the rest of the question's life — the guess screen and all
 * three reveal slides — so nothing under it ever has to move to make room for
 * it a second time.
 */
function QuestionStrip({ question }: { question: Question }): React.JSX.Element {
  return (
    <div className="question-block question-block--strip block block--cream block--sm">
      <h1 className="question question--strip">{question.text}</h1>
    </div>
  );
}

/** `2026-08-15` as `15 aug 2026`. The stylesheet does the shouting. */
function formatDay(day: string): string {
  const MONTHS = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ];
  const [year, month, date] = day.split('-');
  const name = MONTHS[Number(month) - 1];
  if (!year || !date || name === undefined) return day;
  return `${Number(date)} ${name} ${year}`;
}

/**
 * Who asked, and what they look like.
 *
 * The single highest-value counter in the app: it is the one a player sees
 * before they have one, on somebody else, attached to a name — which is what
 * makes wanting one make sense. It costs one avatar lookup on an id the server
 * was already holding.
 *
 * House questions never reach here; they have no author line at all.
 */
function Byline({
  name,
  avatar,
}: {
  name: string;
  avatar: Equipped | null;
}): React.JSX.Element {
  return (
    <p className="question__byline">
      {/* On a cream block, so the counter needs the shadow it would otherwise
          be standing on the felt for — see `.dot-slot--cameo::before`. */}
      <span className="question__cast">
        <Blob
          face={avatar?.face}
          accessory={avatar?.accessory}
          size={COUNTER_SIZE.inline}
        />
      </span>
      <span className="question__meta">asked by u/{name}</span>
    </p>
  );
}

/** Tap an answer, drag the slider, lock in. */
function PlayView({
  postId,
  question,
  avatar,
  canVote,
  locked,
  onReveal,
}: {
  postId: string;
  question: Question;
  avatar: Equipped | null;
  canVote: boolean;
  locked: boolean;
  onReveal: (reveal: Reveal) => void;
}): React.JSX.Element {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [guess, setGuess] = useState(DEFAULT_GUESS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (locked) {
    // Only reachable for a question closed by hand, which may have no summary in
    // the thread to point at. Old Dailies are never closed.
    return <p className="notice notice--spaced">Voting is closed on this one.</p>;
  }
  if (!canVote) {
    return <p className="notice notice--spaced">Sign in to play.</p>;
  }

  async function lockIn(): Promise<void> {
    if (choice === null) return;
    setSubmitting(true);
    setError(null);
    try {
      onReveal(await castVote(postId, choice, guess));
    } catch (failure) {
      // A 409 carries the reveal this player already earned — show it rather
      // than an error.
      if (failure instanceof ApiFailure && failure.reveal) {
        onReveal(failure.reveal);
        return;
      }
      setError(failure instanceof Error ? failure.message : 'Could not record that.');
      setSubmitting(false);
    }
  }

  // The crowd is on the table from the first frame, undifferentiated: a hundred
  // people, not a split. The reveal then sweeps these same counters into two
  // piles, which is the whole point of the moment.
  if (choice === null) {
    return (
      <div className="guess">
        <QuestionCard question={question} avatar={avatar} />
        <div className="stage">
          <DotCrowd withYou={null} />
        </div>
        <div className="choices">
          <button
            type="button"
            className="button block block--yellow block--lg choice"
            onClick={() => setChoice('a')}
          >
            <span className="choice__label">{question.labelA}</span>
          </button>
          <button
            type="button"
            className="button block block--orange block--lg choice"
            onClick={() => setChoice('b')}
          >
            <span className="choice__label">{question.labelB}</span>
          </button>
        </div>
      </div>
    );
  }

  const label = choice === 'a' ? question.labelA : question.labelB;
  const otherLabel = choice === 'a' ? question.labelB : question.labelA;
  // The slider is a percentage; the crowd is counters. Same number today, but
  // the conversion is what is meant.
  const dotsGuessed = (guess / 100) * CROWD_SIZE;

  // Now that there is a side, the crowd answers the slider: the guess turns the
  // counters standing with you yellow, in place. Nothing has moved yet — the
  // travel into camps is the reveal's, and spending it here would spend it
  // twice.
  return (
    <div className="guess">
      <QuestionStrip question={question} />

      <div className="stage">
        <DotCrowd
          withYou={null}
          split={dotsGuessed}
          yourLabel={label}
          otherLabel={otherLabel}
        />
      </div>

      {/* One group, so the controls arrive together and after the crowd has
          made room for them. */}
      <div className="guess__controls">
        <div className="panel block block--cream block--lg">
          {/* A question and its answer on one line. The label already says out
              of how many, so the number does not repeat it — and the row it
              saves goes to the crowd, which is what this screen is about. */}
          <p className="guess__head">
            <span className="label">
              You said {label} — how many out of {CROWD_SIZE} agree?
            </span>
            <span className="bignum">{guess}</span>
          </p>

          <input
            className="slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={guess}
            aria-label={`Percentage of people who also said ${label}`}
            // The fill under the thumb is the value, so it is the one thing on
            // this screen a stylesheet cannot know.
            style={{ '--fill': `${guess}%` } as React.CSSProperties}
            onChange={(event) => setGuess(Number(event.target.value))}
          />
        </div>

        {/* The same shape the reveal's nav has: the way back is a slot cut into
            the felt, the way on is a block standing on it. */}
        <div className="guess__actions">
          <button
            type="button"
            className="well-button guess__change"
            // One word on the button and the whole phrase in the name it is
            // announced by: the block beside it is the sentence's other half.
            aria-label="Change answer"
            onClick={() => setChoice(null)}
          >
            Change
          </button>

          <button
            type="button"
            className="button block block--yellow block--lg guess__lock"
            onClick={lockIn}
            disabled={submitting}
          >
            {submitting ? 'Locking in...' : 'Lock it in'}
          </button>
        </div>

        {error && <p className="notice notice--quiet notice--spaced">{error}</p>}
      </div>
    </div>
  );
}

/**
 * The verdict, told in three slides. Each one fits its screen, and each one
 * makes a single point:
 *
 *   1. The crowd — the counters sweep into camps, and how many stand with you.
 *   2. The score — your guess against the number, the badge, the histogram.
 *   3. The share — the pre-written comment, an optional line, one tap to post.
 *
 * The sweep belongs to slide one and the award's arrival to slide two, so each
 * slide keeps its own moment instead of everything firing at once.
 *
 * The share slide is the end of the question, so the step that carried "next"
 * on the way here carries "menu" instead of nothing.
 */
function RevealView({
  postId,
  question,
  reveal,
  animate,
  slide,
  onSlide,
  onOpenMenu,
  onBlobNoticed,
}: {
  postId: string;
  question: Question;
  reveal: Reveal;
  animate: boolean;
  slide: number;
  onSlide: (slide: number) => void;
  onOpenMenu: () => void;
  onBlobNoticed: () => void;
}): React.JSX.Element {
  const mine = reveal.choice === 'a' ? question.labelA : question.labelB;
  const theirs = reveal.choice === 'a' ? question.labelB : question.labelA;
  const rest = CROWD_SIZE - reveal.dotsWithYou;

  const captionBits = [
    `${reveal.dotsWithYou} ${mine} · ${rest} ${theirs}`,
    votesCaption(reveal, question),
  ];

  // Which camp each cameo stands in is decided here, where the viewer's own
  // choice is known, so the crowd never has to learn what a choice is.
  //
  // Held across renders because pointing at a counter is a render: without this
  // the crowd would be handed a new list on every hover and would re-pack a
  // hundred pieces to answer a question about one of them.
  const cameos = useMemo(
    () =>
      reveal.cameos.map((cameo) => ({
        name: cameo.name,
        avatar: cameo.avatar,
        withYou: cameo.choice === reveal.choice,
      })),
    [reveal.cameos, reveal.choice]
  );

  // Whoever is being pointed at, if anyone. The caption is already the line
  // under the crowd that carries the small print about it, so a name goes
  // there rather than into a label of its own.
  const [named, setNamed] = useState<string | null>(null);

  const SLIDE_COUNT = 3;

  return (
    <div className="reveal">
      <QuestionStrip question={question} />

      {slide === 0 && (
        <div className="slide" key="crowd">
          <div className="stage">
            <DotCrowd
              withYou={reveal.dotsWithYou}
              yourLabel={mine}
              otherLabel={theirs}
              animate={animate}
              cameos={cameos}
              onName={setNamed}
            />
          </div>

          <div className="verdict block block--cream block--md">
            <p className="verdict__line">
              <span className="verdict__count">{reveal.dotsWithYou}</span>
              <span className="verdict__unit">
                out of {CROWD_SIZE} with you
              </span>
            </p>
            {/* One line, two jobs. The split and the sample size are what it
                says at rest; a name takes the whole line while one is being
                asked for, because the alternative is a second line that is
                empty most of the time and moves everything under it when it is
                not. */}
            <p className="crowd__caption">
              {named ? `u/${named}` : captionBits.join(' · ')}
            </p>
          </div>

          {reveal.blobNotice && <BlobNotice onAnswered={onBlobNoticed} />}
        </div>
      )}

      {slide === 1 && (
        <div className="slide slide--score fade-in" key="score">
          <div className="score__left">
            <div className="figures">
              <div className="figure well">
                <span className="label label--felt">you said</span>
                <span className="figure__value">{reveal.guess}</span>
              </div>
              <div className="figure well">
                <span className="label label--felt">it was</span>
                <span className="figure__value figure__value--orange">{reveal.actual}</span>
              </div>
              <div className="figure well">
                <span className="label label--felt">off by</span>
                <span className="figure__value figure__value--yellow">{reveal.error}</span>
              </div>
            </div>

            <PointsAward award={reveal.award} animate={animate} />
          </div>

          {/* Where everyone guessed, and nothing else. The well stays whether or
              not there are bars — it is what takes the slack on this slide —
              but the label goes with them. `Histogram` renders nothing at all on
              a question with no guesses banked, and a heading over an empty hole
              is a heading for nothing.

              The badge that used to sit above this well is what pays for the
              chart's height. It has not left the game: `buildComment` puts its
              title in the comment posted to the thread, which is where the 2x2
              was always going to be read by anybody but you. */}
          <div className="score__right">
            <div className="detail well">
              {reveal.histogram.some((count) => count > 0) && (
                <span className="label label--felt">where everyone guessed</span>
              )}
              <Histogram buckets={reveal.histogram} yourGuess={reveal.guess} />
            </div>
          </div>
        </div>
      )}

      {slide === 2 && (
        <div className="slide fade-in" key="share">
          <Compose postId={postId} question={question} reveal={reveal} />
        </div>
      )}

      <nav className="slides__nav" aria-label="Reveal pages">
        <button
          type="button"
          className="well-button slides__step"
          onClick={() => onSlide(slide - 1)}
          disabled={slide === 0}
          style={{ visibility: slide === 0 ? 'hidden' : 'visible' }}
        >
          Back
        </button>

        <div className="slides__bars" aria-hidden="true">
          {Array.from({ length: SLIDE_COUNT }, (_, index) => (
            <span
              key={index}
              className={`slides__bar${index === slide ? ' is-active' : ''}`}
            />
          ))}
        </div>

        {slide < SLIDE_COUNT - 1 ? (
          <button
            type="button"
            className="button block block--yellow block--md slides__step"
            onClick={() => onSlide(slide + 1)}
          >
            Next
          </button>
        ) : (
          <button type="button" className="well-button slides__step" onClick={onOpenMenu}>
            Menu
          </button>
        )}
      </nav>
    </div>
  );
}

/**
 * The first time this player's own counter could turn up in somebody else's
 * crowd.
 *
 * The setting ships on, and that is a real change to what the game discloses:
 * until now the only way your answer became public was if you tapped share and
 * posted the comment yourself. So it is said on the screen where it is
 * happening, at the moment it starts happening — they have just voted, so they
 * are in the window already. Nobody's first encounter with this should be
 * discovering that it already happened.
 *
 * It is a notice and not a question. One control, the same X that closes
 * anything, and the copy says where the switch lives — which keeps the reveal
 * a reveal rather than a consent form on the way to one, and keeps the setting
 * in the single place it can be changed from twice.
 *
 * Closing it *is* the write: nothing separately records having told anybody,
 * only what they have chosen, and the default they are accepting by closing is
 * on. See `showBlob` in `server/core/keys.ts`. A write that fails therefore
 * leaves the notice due to fire again, which is the right way round for it to
 * break — the alternative is a player who was told once, silently, and has no
 * idea it happened.
 */
function BlobNotice({ onAnswered }: { onAnswered: () => void }): React.JSX.Element {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function dismiss(): Promise<void> {
    setSaving(true);
    setFailed(false);
    try {
      await saveShowBlob(true);
      onAnswered();
    } catch {
      setFailed(true);
      setSaving(false);
    }
  }

  return (
    <div className="blob-notice block block--cream block--sm" role="status">
      {/* Short on purpose. This lands on somebody's first reveal, and the
          crowd gives up height for every line of it. */}
      <p className="blob-notice__copy">
        Your counter can turn up in other players&rsquo; crowds now, on the side you
        answered. Turn that off any time in Your record.
      </p>
      <button
        type="button"
        className="blob-notice__close"
        aria-label="Got it"
        disabled={saving}
        onClick={() => void dismiss()}
      >
        <Cross />
      </button>
      {failed && (
        <p className="notice notice--quiet notice--cream">That did not save. It will ask again.</p>
      )}
    </div>
  );
}

/**
 * The X, drawn rather than typed, for the same reason the wardrobe's chevrons
 * are: the bundled fonts are subsetted to the Latin ranges they need, so a
 * multiplication sign or a dingbat would fall through to whatever the device
 * happens to have.
 */
function Cross(): React.JSX.Element {
  return (
    <svg className="cross" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M 4 4 L 12 12 M 12 4 L 4 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * What the vote paid.
 *
 * A block, and one of only two on the score slide: this is being handed to you,
 * and everything else on that screen is a record of what already happened and
 * sits in a well. The band label leads and the number follows it — "Bullseye"
 * is the thing worth saying and "+60" is the receipt — and the total counts up
 * on arrival because it is the one figure here that was earned rather than
 * reported.
 */
function PointsAward({ award, animate }: { award: Award; animate: boolean }): React.JSX.Element {
  const band = getBand(award.band);
  const total = useCountUp(award.total, animate);

  return (
    <div
      className={`award block block--yellow block--md${animate ? ' is-arriving' : ''}`}
      role="status"
    >
      <span className="award__head">
        <span className="award__band">{band.label}</span>
        <span className="award__breakdown">
          {award.base} for playing
          {award.bonus > 0 ? ` · ${award.bonus} for landing within ${band.maxError}` : ''}
        </span>
      </span>
      {/* The count-up is decoration, so it is hidden and the settled total is
          announced instead — a screen reader should not be read a number still
          in flight. */}
      <span className="award__total" aria-hidden="true">
        +{total}
      </span>
      <span className="visually-hidden">{award.total} points</span>
    </div>
  );
}

/**
 * How big the crowd behind the split actually is.
 *
 * Always shown, not just when the sample is thin: the split means one thing at
 * twelve votes and another at twelve hundred, and the reader cannot tell which
 * they are looking at from a percentage.
 */
function votesCaption(reveal: Reveal, question: Question): string {
  const { total } = reveal.tally;
  const votes = `${total} ${total === 1 ? 'vote' : 'votes'}`;
  if (reveal.provisional) return `${votes} so far`;
  // Only today's Daily can claim "today". An open question, or a Daily played
  // out of the archive, has been collecting votes since it was posted.
  return question.isToday ? `${votes} today` : votes;
}
