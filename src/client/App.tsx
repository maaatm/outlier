/**
 * See question → tap an answer → drag the slider → lock in → reveal.
 *
 * Two taps, no typing, under fifteen seconds. Everything on the way to the
 * reveal is instant; the reveal is the one orchestrated moment.
 */

import { context } from '@devvit/web/client';
import { useCallback, useEffect, useState } from 'react';

import { getBadge } from '../shared/badges.js';
import { CROWD_SIZE } from '../shared/config.js';
import { getBand, type Award } from '../shared/points.js';
import type { Choice, Question, QuestionState, Reveal, StateResponse } from '../shared/types.js';
import { ApiFailure, castVote, fetchState } from './api.js';
import { randomGroupColors } from './colors.js';
import { BadgeStamp } from './components/BadgeStamp.js';
import { Compose } from './components/Compose.js';
import { DotCrowd } from './components/DotCrowd.js';
import { Histogram } from './components/Histogram.js';
import { Leaderboard } from './components/Leaderboard.js';
import { Menu } from './components/Menu.js';
import { StatBar } from './components/StatBar.js';
import { WobbleRule } from './components/WobbleRule.js';
import { useCountUp } from './countUp.js';

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
        <div className="card">
          <p className="notice">{phase.message}</p>
        </div>
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
    return <Menu stats={state.stats} />;
  }

  if (screen === 'menu') {
    return <Menu stats={state.stats} onExit={() => setScreen('game')} />;
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
}: {
  postId: string;
  state: QuestionState;
  justVoted: boolean;
  slide: number;
  onSlide: (slide: number) => void;
  onOpenMenu: () => void;
  onReveal: (reveal: Reveal) => void;
}): React.JSX.Element {
  const { question, reveal, stats, canVote } = state;

  return (
    <main className="app">
      <header className="header">
        <span className="header__mark">Outlier</span>
        <span className="header__day">
          {question.isDaily ? question.dailyDate : 'open question'}
        </span>
        <StatBar stats={stats} />
      </header>

      <section className="card">
        {question.source === 'community' && question.authorName && (
          <p className="question__meta">asked by u/{question.authorName}</p>
        )}
        <h1 className="question">{question.text}</h1>
        <WobbleRule />

        {reveal ? (
          <RevealView
            postId={postId}
            question={question}
            reveal={reveal}
            animate={justVoted}
            slide={slide}
            onSlide={onSlide}
            onOpenMenu={onOpenMenu}
          />
        ) : (
          <PlayView
            postId={postId}
            question={question}
            canVote={canVote}
            locked={question.locked}
            onReveal={onReveal}
          />
        )}
      </section>
    </main>
  );
}

/** Tap an answer, drag the slider, lock in. */
function PlayView({
  postId,
  question,
  canVote,
  locked,
  onReveal,
}: {
  postId: string;
  question: Question;
  canVote: boolean;
  locked: boolean;
  onReveal: (reveal: Reveal) => void;
}): React.JSX.Element {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [guess, setGuess] = useState(DEFAULT_GUESS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Drawn once per question, not per frame: the pair has to hold still while
  // the slider moves, or the crowd strobes.
  const [groupColors] = useState(randomGroupColors);

  if (locked) {
    // Only reachable for a question closed by hand, which may have no summary in
    // the thread to point at. Old Dailies are never closed.
    return <p className="notice">Voting is closed on this one.</p>;
  }
  if (!canVote) {
    return <p className="notice">Sign in to play.</p>;
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

  // The crowd is on screen from the first frame, undifferentiated: a hundred
  // people, not a split. The reveal then reorganises these same dots, which is
  // the whole point of the moment.
  if (choice === null) {
    return (
      <div className="guess">
        <div className="stage">
          <DotCrowd withYou={null} accent="signal" />
        </div>
        <div className="choices">
          <button type="button" className="button" onClick={() => setChoice('a')}>
            <span className="choice__label">{question.labelA}</span>
          </button>
          <button type="button" className="button" onClick={() => setChoice('b')}>
            <span className="choice__label">{question.labelB}</span>
          </button>
        </div>
      </div>
    );
  }

  const label = choice === 'a' ? question.labelA : question.labelB;
  const otherLabel = choice === 'a' ? question.labelB : question.labelA;
  // The slider is a percentage; the crowd is dots. Same number today, but the
  // conversion is what is meant.
  const dotsGuessed = (guess / 100) * CROWD_SIZE;

  // Now that there is a side, the crowd answers the slider: the guess splits it
  // into two coloured groups in place. Nothing has moved yet — the travel into
  // camps is the reveal's, and spending it here would spend it twice.
  return (
    <div className="guess">
      <div className="stage">
        <DotCrowd
          withYou={null}
          accent="signal"
          split={dotsGuessed}
          groupColors={groupColors}
          yourLabel={label}
          otherLabel={otherLabel}
        />
      </div>

      {/* One group, so the controls arrive together and after the crowd has
          made room for them. */}
      <div className="guess__controls">
        <p className="guess__prompt">
          You said <strong>{label}</strong>. How many out of {CROWD_SIZE} agree?
        </p>

        <div className="guess__readout">
          <span className="bignum">{guess}</span>
          <span className="guess__unit">out of {CROWD_SIZE}</span>
        </div>

        <input
          className="slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={guess}
          aria-label={`Percentage of people who also said ${label}`}
          onChange={(event) => setGuess(Number(event.target.value))}
        />
        <div className="slider__ticks">
          <span>0</span>
          <span>100</span>
        </div>

        <button
          type="button"
          className="button button--primary"
          onClick={lockIn}
          disabled={submitting}
        >
          {submitting ? 'Locking in...' : 'Lock it in'}
        </button>

        <button type="button" className="button button--quiet" onClick={() => setChoice(null)}>
          Change answer
        </button>

        {error && <p className="notice notice--quiet">{error}</p>}
      </div>
    </div>
  );
}

/**
 * The verdict, told in three slides. Each one fits its screen, and each one
 * makes a single point:
 *
 *   1. The crowd — the dots split into camps, and how many stand with you.
 *   2. The score — your guess against the number, the badge, the histogram.
 *   3. The share — the pre-written comment, an optional line, one tap to post.
 *
 * The travel animation belongs to slide one and the stamp to slide two, so
 * each slide keeps its own moment instead of everything firing at once.
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
}: {
  postId: string;
  question: Question;
  reveal: Reveal;
  animate: boolean;
  slide: number;
  onSlide: (slide: number) => void;
  onOpenMenu: () => void;
}): React.JSX.Element {
  const accent = getBadge(reveal.badge).accent;
  const mine = reveal.choice === 'a' ? question.labelA : question.labelB;
  const theirs = reveal.choice === 'a' ? question.labelB : question.labelA;
  const rest = CROWD_SIZE - reveal.dotsWithYou;
  const [detail, setDetail] = useState<'guesses' | 'misjudged'>('guesses');

  const captionBits = [
    `${reveal.dotsWithYou} ${mine} \u00b7 ${rest} ${theirs}`,
    votesCaption(reveal, question),
  ];

  const SLIDE_COUNT = 3;

  return (
    <div className="reveal">
      {slide === 0 && (
        <div className="slide" key="crowd">
          <div className="stage">
            <DotCrowd
              withYou={reveal.dotsWithYou}
              accent={accent}
              yourLabel={mine}
              otherLabel={theirs}
              animate={animate}
            />
          </div>
          <p className="verdict">
            {reveal.minority ? 'Only ' : ''}
            <strong>
              {reveal.dotsWithYou} out of {CROWD_SIZE}
            </strong>{' '}
            are with you.
          </p>
          <p className="crowd__caption">{captionBits.join(' \u00b7 ')}</p>
        </div>
      )}

      {slide === 1 && (
        <div className="slide fade-in" key="score">
          <div className="figures">
            <div className="figure">
              <span className="figure__label">you said</span>
              <span className="figure__value">
                {reveal.guess}
                <span className="figure__unit">%</span>
              </span>
            </div>
            <div className="figure">
              <span className="figure__label">it was</span>
              <span className="figure__value">
                {reveal.actual}
                <span className="figure__unit">%</span>
              </span>
            </div>
            <div className="figure">
              <span className="figure__label">off by</span>
              <span className="figure__value">
                {reveal.error}
                <span className="figure__unit">%</span>
              </span>
            </div>
          </div>

          <PointsAward award={reveal.award} animate={animate} />

          <BadgeStamp id={reveal.badge} animate={animate} />

          <div className="detail">
            <div className="detail__tabs">
              <button
                type="button"
                className={`detail__tab${detail === 'guesses' ? ' is-active' : ''}`}
                onClick={() => setDetail('guesses')}
              >
                where everyone guessed
              </button>
              <button
                type="button"
                className={`detail__tab${detail === 'misjudged' ? ' is-active' : ''}`}
                onClick={() => setDetail('misjudged')}
              >
                hardest to read
              </button>
            </div>
            {detail === 'guesses' ? (
              <Histogram buckets={reveal.histogram} yourGuess={reveal.guess} accent={accent} />
            ) : (
              <Leaderboard />
            )}
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
          className="button button--quiet slides__step"
          onClick={() => onSlide(slide - 1)}
          disabled={slide === 0}
          style={{ visibility: slide === 0 ? 'hidden' : 'visible' }}
        >
          Back
        </button>

        <div className="slides__dots" aria-hidden="true">
          {Array.from({ length: SLIDE_COUNT }, (_, index) => (
            <span
              key={index}
              className={`slides__dot${index === slide ? ' is-active' : ''}`}
            />
          ))}
        </div>

        {slide < SLIDE_COUNT - 1 ? (
          <button
            type="button"
            className="button slides__step"
            onClick={() => onSlide(slide + 1)}
          >
            Next
          </button>
        ) : (
          <button type="button" className="button slides__step" onClick={onOpenMenu}>
            Menu
          </button>
        )}
      </nav>
    </div>
  );
}

/**
 * What the vote paid.
 *
 * The band label leads and the number follows it: "Bullseye" is the thing worth
 * saying and "+60" is the receipt. The total counts up on arrival because it is
 * the one figure here that was earned rather than reported.
 *
 * Deliberately unaccented. The badge stamp and the histogram on this slide
 * already spend both of the two accents the screen is allowed.
 */
function PointsAward({ award, animate }: { award: Award; animate: boolean }): React.JSX.Element {
  const band = getBand(award.band);
  const total = useCountUp(award.total, animate);

  return (
    <div className="award">
      <div className="award__head">
        <span className="award__band">{band.label}</span>
        {/* The count-up is decoration, so it is hidden and the settled total is
            announced instead — a screen reader should not be read a number
            still in flight. */}
        <span className="award__total" aria-hidden="true">
          +{total}
        </span>
        <span className="visually-hidden">{award.total} points</span>
      </div>
      <p className="award__breakdown">
        {award.base} for playing
        {award.bonus > 0 ? ` · ${award.bonus} for landing within ${band.maxError}` : ''}
      </p>
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
