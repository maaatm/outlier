/**
 * The main menu.
 *
 * Reached from the comment slide, which is the one place in the loop where the
 * player has finished the question and has nothing left to tap. It is also the
 * whole of the pinned menu post, where somebody may be meeting the game for the
 * first time.
 *
 * Most of the list is a read — what they have banked, who is ahead. Nothing on
 * this screen can change a vote, and nothing on it exposes a tally the player
 * has not already earned.
 *
 * Two rooms write, and they are not the same kind of writing. The wardrobe
 * changes what a counter looks like, which is undone by pressing the other
 * arrow. Ask a question creates a real post on the subreddit under the player's
 * own name: public, permanent, and not undone by anything in this app. It leads
 * the list because it is the only entry that adds to the subreddit rather than
 * reading it back, and what guards it is not its position — it is that the room
 * is the confirmation step, with one deliberate button instead of the
 * wardrobe's saving as it goes.
 *
 * The one exception is the Daily action at the top, which is not a room: every
 * entry below it opens in place, and that one leaves the post entirely. It is
 * the orange block for exactly that reason — a player should be able to tell
 * which way a control goes before tapping it.
 */

import { navigateTo } from '@devvit/web/client';
import { useEffect, useRef, useState } from 'react';

import { royaltyFor } from '../../shared/coins.js';
import {
  BOX_PRICE,
  COINS_COMMENT,
  COINS_FIRST_VOTE,
  COINS_PROMOTION,
  COINS_STREAK_BONUS,
  COINS_SUBMISSION,
  COMMENT_UPVOTE_COIN_CAP,
  HIT_THRESHOLD,
  ROYALTY_VOTES_PER_COIN,
  STREAK_BONUS_EVERY,
  SUBMITTED_LABEL_MAX_LENGTH,
  SUBMITTED_QUESTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from '../../shared/config.js';
import { EARN_COPY, type Earning } from '../../shared/earnings.js';
import {
  ACCESSORIES,
  type Equipped,
  FACES,
  ITEMS,
  type Item,
  findItem,
  itemIndex,
  ownedItems,
  resolveAccessory,
  resolveFace,
  stepItem,
} from '../../shared/items.js';
import type {
  AvatarResponse,
  BoxResponse,
  DailyPointer,
  PlayerStats,
} from '../../shared/types.js';
import { normalizeTitle, validateSubmission } from '../../shared/validate.js';
import {
  fetchAvatar,
  fetchDaily,
  fetchEarnings,
  openBox,
  saveAvatar,
  savePush,
  saveShowBlob,
  submitQuestion,
} from '../api.js';
import { coalescingWriter } from '../coalesce.js';
import { COUNTER_SIZE } from '../counterArt.js';
import { WORDMARK_SIZE } from '../wordmarkArt.js';
import { Blob } from './Blob.js';
import { CoinTag } from './CoinTag.js';
import { Cross } from './Cross.js';
import { PlayerBoard } from './PlayerBoard.js';
import { StatBar, StatPill } from './StatBar.js';
import { Wordmark } from './Wordmark.js';

type PanelId = 'record' | 'wardrobe' | 'board' | 'ask';

/** What the header calls each room. The felt titles below are their own. */
const TITLES: Record<PanelId, string> = {
  record: 'Your record',
  wardrobe: 'Wardrobe',
  board: 'Leaderboard',
  ask: 'Ask a question',
};

/**
 * What the header calls the list itself.
 *
 * The list used to carry the wordmark here, like the game's screens do. It
 * stopped when the wordmark left the hero block and came down onto the felt at
 * full size: a 22px lockup directly above a 58px one is the mark twice, and the
 * smaller of the two would be doing the job a screen label does anyway.
 */
const ROOT_TITLE = 'Menu';

type Entry = {
  id: PanelId;
  /** One dry line under the label. Says what the room holds, not why to open it. */
  blurb: string;
};

/**
 * Ask a question is first, because it is the only entry here that adds anything
 * to the subreddit and the only one worth putting in front of somebody who has
 * just arrived on the pinned menu post. The three below it are all readings of
 * what has already happened, in the usual order: you, your counter, everyone
 * else.
 */
const ENTRIES: Entry[] = [
  { id: 'ask', blurb: 'write one and post it to the subreddit' },
  { id: 'record', blurb: 'your streak, your points, how well you call it' },
  { id: 'wardrobe', blurb: "your counter's face and what it wears" },
  { id: 'board', blurb: 'who has the most points' },
];

/**
 * Reddit hands back permalinks as paths, and `navigateTo` throws on anything it
 * cannot parse as a whole URL, so the origin is applied at the last moment
 * rather than stored on the wire as part of the permalink.
 */
const REDDIT_ORIGIN = 'https://www.reddit.com';

/**
 * `onExit` is absent on the pinned menu post, where the menu *is* the post and
 * there is no question behind it to go back to. The button goes with it rather
 * than sitting there pointing at nothing.
 *
 * `postId` is the post the menu is open on, and is only used to ask the server
 * whether that post is today's Daily. The menu post has no question on it, so
 * the server cannot work it out from a `post:` lookup.
 *
 * `canSubmit` rides in on the state response rather than being fetched here: it
 * is one boolean about whether the viewer is signed in, and the room it governs
 * is the one place a signed-out visitor most needs to be told why a control is
 * inert rather than shown nothing at all.
 */
export function Menu({
  stats,
  postId,
  canSubmit,
  onExit,
}: {
  stats: PlayerStats;
  postId?: string;
  canSubmit: boolean;
  onExit?: () => void;
}): React.JSX.Element {
  const [panel, setPanel] = useState<PanelId | null>(null);
  const showBack = panel !== null || onExit !== undefined;

  // Fetched here rather than in `Root`, which remounts on every trip into a
  // room and back: one pointer per menu open, and no second flash of the
  // disabled state on the way back to the list.
  const [daily, setDaily] = useState<DailyPointer | null>(null);
  useEffect(() => {
    let live = true;
    fetchDaily(postId)
      .then((pointer) => live && setDaily(pointer))
      // A pointer that never arrives leaves the button inert. Better than
      // offering a trip to a post that may not be there.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [postId]);

  /*
   * The balance this screen shows, wherever the newest word about it came from.
   *
   * `stats` was settled when the post loaded, and three things in here are
   * newer than that: the wardrobe's fetch, a box opened out of it, and the
   * ledger's own read. Each of them pushes what it learned in here as it
   * happens, so the last word wins — which is the right rule, because the last
   * word is the most recent one. Held at this level because the header is at
   * this level: a counter in the header that a room below it can spend has to
   * be owned above both of them.
   */
  const [balance, setBalance] = useState(stats.coins);

  const { avatar, equip, absorb, show, push } = useAvatar(
    panel === 'record' || panel === 'wardrobe',
    setBalance
  );
  // The ledger is a sheet over the whole menu rather than a block inside a
  // room, so whether it is open is the menu's business and not the room's.
  const [ledger, setLedger] = useState(false);
  const entries = useEarnings(ledger, setBalance);

  // The dot is a question about the moment the menu was opened, and opening the
  // ledger is what answers it — the fetch above marks it seen on the server,
  // and this is the same fact on this side of the wire. Held here rather than
  // in `Root`, which remounts on every trip out of a room and back.
  const [ledgerOpened, setLedgerOpened] = useState(false);
  useEffect(() => {
    if (ledger) setLedgerOpened(true);
  }, [ledger]);

  return (
    <main className="app">
      {/*
        The same header as the game, down to the pills, so opening the menu
        moves nothing on the way in or back out. The wordmark gives way to a
        screen label everywhere in here: you are past the front door, and on the
        list itself the mark is on the felt below at full size.
      */}
      <header className="header">
        <span className="header__label">{panel === null ? ROOT_TITLE : TITLES[panel]}</span>
        <HeaderStats panel={panel} stats={{ ...stats, coins: balance }} avatar={avatar} />
      </header>

      {/* Keyed so a page change remounts and cross-fades, and so a room opened
          after a long one starts at the top rather than mid-scroll. */}
      <div className="menu__body fade-in" key={panel ?? 'root'}>
        {panel === null && (
          <Root
            onOpen={setPanel}
            daily={daily}
            unseen={stats.unseenEarnings && !ledgerOpened}
          />
        )}
        {panel === 'record' && (
          <Record
            stats={stats}
            avatar={avatar}
            coins={balance}
            unseen={stats.unseenEarnings && !ledgerOpened}
            onShow={show}
            onPush={push}
            onOpenLedger={() => setLedger(true)}
          />
        )}
        {panel === 'wardrobe' && (
          <Wardrobe avatar={avatar} onEquip={equip} onOpened={absorb} />
        )}
        {panel === 'board' && <Board />}
        {panel === 'ask' && <Ask canSubmit={canSubmit} />}
      </div>

      {showBack && (
        <button
          type="button"
          className="well-button menu__back"
          onClick={() => (panel === null ? onExit?.() : setPanel(null))}
        >
          {panel === null ? 'Back to the question' : 'Back to menu'}
        </button>
      )}

      {/* Last in the tree so it lays over everything above it, and mounted by
          the menu rather than by the room that opens it — a sheet belongs to the
          screen it covers, and this one stays put while the room behind it
          scrolls or changes. */}
      {ledger && <Ledger entries={entries} onClose={() => setLedger(false)} />}
    </main>
  );
}

/**
 * What the header carries in each room.
 *
 * A room is already about one number, and the other one is noise in it: the
 * wardrobe is about coins, and everywhere you are only reading, points. The
 * list is the one place both counters belong, because from there you might be
 * going anywhere.
 */
function HeaderStats({
  panel,
  stats,
  avatar,
}: {
  panel: PanelId | null;
  stats: PlayerStats;
  avatar: AvatarResponse | null;
}): React.JSX.Element | null {
  if (panel === null || panel === 'record') return <StatBar stats={stats} />;

  // Absent rather than zero when signed out: a balance of nothing reads as an
  // account with nothing in it, and there is no account.
  if (panel === 'wardrobe') {
    return avatar?.canSave ? <StatPill label="coins" value={avatar.coins} tone="coins" /> : null;
  }

  return <StatPill label="pts" value={stats.points} />;
}

/**
 * The equipped pair, fetched the first time a room needs it and held for the
 * rest of the menu's life.
 *
 * It lives up in `Menu` rather than inside `Record`, which unmounts on the way
 * into the wardrobe: state held in either room would refetch on every trip
 * between the two and flash the starter counter in the gap. The menu root never
 * pays for it at all, because nothing there shows a counter.
 */
function useAvatar(
  needed: boolean,
  /** Called with the balance every time this hook learns a newer one. */
  onBalance: (coins: number) => void
): {
  avatar: AvatarResponse | null;
  equip: (next: Equipped) => void;
  absorb: (box: BoxResponse) => void;
  show: (showBlob: boolean) => void;
  push: (next: boolean) => void;
} {
  const [avatar, setAvatar] = useState<AvatarResponse | null>(null);

  useEffect(() => {
    if (!needed || avatar !== null) return;
    let live = true;
    fetchAvatar()
      .then((next) => {
        if (!live) return;
        setAvatar(next);
        onBalance(next.coins);
      })
      // Nothing to say if it never arrives: the rooms render the starter pair
      // while this is null, which is what the player would be wearing anyway.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [needed, avatar, onBalance]);

  /*
   * One writer for the life of the menu, built on first render rather than in a
   * `useMemo`, which is free to throw its result away. A second writer would be
   * a second thing able to have a write in flight, and having only one is half
   * of what it is for.
   */
  const write = useRef<((next: Equipped) => void) | null>(null);
  write.current ??= coalescingWriter<Equipped, AvatarResponse>({
    send: saveAvatar,
    onLatest: setAvatar,
    recover: () => fetchAvatar().catch(() => null),
  });

  function equip(next: Equipped): void {
    if (avatar === null) return;

    // What is drawn is settled here and by nothing else. A press is instant, so
    // the round trip it starts has nothing to add to the picture — it is only
    // there to make the server agree, and `coalesce.ts` is what stops a slow
    // answer to an old press from arriving as if it were news.
    setAvatar((current) => (current ? { ...current, ...next } : current));
    write.current?.(next);
  }

  /**
   * Fold a box result into what is held, rather than refetching it.
   *
   * The response already carries both halves of what changed — the balance and,
   * on a new item, one more thing owned — so a second round trip would only be
   * a chance for the screen to flicker back to what it already knows.
   */
  function absorb(box: BoxResponse): void {
    // A box is the one thing in the menu that *spends*, so the header has to
    // hear about it too — otherwise the balance up there is the one from before
    // the purchase until the whole post is loaded again.
    onBalance(box.coins);
    setAvatar((current) =>
      current === null
        ? current
        : {
            ...current,
            coins: box.coins,
            freeRolls: box.freeRolls,
            owned: current.owned.includes(box.item) ? current.owned : [...current.owned, box.item],
          }
    );
  }

  /**
   * Show the counter to other players, or stop.
   *
   * Its own write rather than a field on the coalescing one above. That writer
   * exists because a stepper can be pressed faster than a round trip completes;
   * a switch cannot be, and folding this into it would mean a slow answer about
   * an accessory could arrive carrying a stale opinion about this.
   *
   * Optimistic, like equipping: the press is the answer, and the request is only
   * there to make the server agree. If it does not, the switch goes back —
   * silently, because the state it goes back to *is* the truth and a player who
   * sees it flip has been told.
   */
  function show(showBlob: boolean): void {
    setAvatar((current) => (current ? { ...current, showBlob } : current));
    saveShowBlob(showBlob).catch(() => {
      setAvatar((current) => (current ? { ...current, showBlob: !showBlob } : current));
    });
  }

  /**
   * Be told when the next Daily is up, or stop being told.
   *
   * Written exactly like `show` above — its own optimistic write, not folded
   * into the coalescing one — with one difference that matters. `savePush` can
   * resolve *successfully* carrying `push: false` after being asked for `true`,
   * because Reddit owns the opt-in ledger and can refuse where nothing else in
   * this app can. So the answer is reconciled against the response rather than
   * only caught: a refusal is a resolved promise, and a handler that only
   * catches would leave the switch showing a choice the player did not get.
   */
  function push(next: boolean): void {
    setAvatar((current) => (current ? { ...current, push: next } : current));
    savePush(next)
      .then((response) => {
        setAvatar((current) =>
          current
            ? { ...current, push: response.push, pushAvailable: response.pushAvailable }
            : current
        );
      })
      .catch(() => {
        setAvatar((current) => (current ? { ...current, push: !next } : current));
      });
  }

  return { avatar, equip, absorb, show, push };
}

/**
 * The ledger, fetched the first time Your record is opened and held for the rest
 * of the menu's life.
 *
 * Held up here for the same reason the avatar is: `Record` unmounts on every
 * trip out of the room, and state inside it would refetch on the way back — but
 * this fetch is also what marks the ledger seen, and asking the server twice to
 * be told the same thing is a round trip spent to say nothing.
 *
 * A failure leaves it null, and the block renders its empty state rather than an
 * error: a receipt that did not arrive is worth less than the room around it.
 *
 * The balance rides back with the entries, because the two are read together on
 * the server and this one is newer than the one the post loaded with — an hourly
 * sweep can pay somebody between the two. It goes straight out to `onBalance`
 * rather than being returned: the ledger sheet does not show a total, and the
 * screens that do are above this hook rather than beside it.
 */
function useEarnings(
  needed: boolean,
  onBalance: (coins: number) => void
): Earning[] | null {
  const [entries, setEntries] = useState<Earning[] | null>(null);

  useEffect(() => {
    if (!needed || entries !== null) return;
    let live = true;
    fetchEarnings()
      .then((response) => {
        if (!live) return;
        setEntries(response.entries);
        onBalance(response.coins);
      })
      // Nothing arrived, so the block teaches instead of waiting forever. The
      // ways to earn are true whether or not this call worked, and the balance
      // stays the one the page was opened with.
      .catch(() => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [needed, entries, onBalance]);

  return entries;
}

/** The list itself, under the wordmark, with the one way out above it. */
function Root({
  onOpen,
  daily,
  unseen,
}: {
  onOpen: (id: PanelId) => void;
  daily: DailyPointer | null;
  /** Something has been paid since this player last opened their record. */
  unseen: boolean;
}): React.JSX.Element {
  return (
    <div className="menu__root">
      {/*
        The mark on the felt, not in a card, and alone above the list. It is
        the name of the table rather than another piece placed on it, so the
        cream hero block that used to wrap it is gone rather than restyled.
        Nothing explains the game here either: the subreddit's sidebar does
        that, and a paragraph on this screen is a paragraph everything else
        has to fit under. What is left is the mark, at the size that room buys.

        Still the heading, because on the pinned menu post this screen is the
        whole document. The lockup names itself — it is one `img` with a label,
        so what is announced is "Outlier, heading level 1" and never the
        letters, which spell `utlier`.
      */}
      <h1 className="menu__wordmark">
        <Wordmark size={WORDMARK_SIZE.menu} />
      </h1>

      <DailyAction daily={daily} />

      <ul className="menu__list">
        {ENTRIES.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="button block block--cream block--sm menu__item"
              onClick={() => onOpen(entry.id)}
            >
              <span className="menu__item-label">
                {TITLES[entry.id]}
                {entry.id === 'ask' && <CoinTag coins={COINS_SUBMISSION} />}
                {entry.id === 'record' && unseen && <UnseenDot />}
              </span>
              <span className="menu__item-blurb">{entry.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The trip out to today's Daily.
 *
 * Inert while the pointer is in flight rather than absent: this sits near the
 * top of the screen, so a control that arrives a moment late shifts everything
 * under it just as the reader settles on it.
 *
 * `none` is the one state that is not a button at all. There is nothing to
 * press until midnight, and a disabled button invites a press.
 */
function DailyAction({ daily }: { daily: DailyPointer | null }): React.JSX.Element {
  if (daily?.state === 'none') {
    return (
      <p className="footnote menu__daily-note">
        The next question goes up at midnight UTC.
      </p>
    );
  }

  if (daily?.state === 'here') {
    return (
      <button type="button" className="button block block--cream block--lg menu__daily" disabled>
        You&rsquo;re on today&rsquo;s question
      </button>
    );
  }

  const permalink = daily?.permalink;
  const played = daily?.state === 'voted';

  return (
    <button
      type="button"
      // Answered already, so it still travels — it just stops being the thing to
      // do next, and gives up the orange accordingly.
      className={`button block block--${played ? 'cream' : 'orange'} block--lg menu__daily`}
      disabled={!permalink}
      onClick={() => permalink && navigateTo(new URL(permalink, REDDIT_ORIGIN).toString())}
    >
      {played ? 'Already played today' : "Today's question"}
    </button>
  );
}

/**
 * The fine print, on the felt at the bottom of a room.
 *
 * It is the rule that would clutter the substance above it but that somebody
 * will eventually want. Body copy rather than a label: two sentences set in
 * tracked-out caps is a thing nobody reads.
 */
function Footnote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="footnote">{children}</p>;
}

/**
 * Banked state, read off the same counters the header shows — and the counter
 * those numbers belong to.
 *
 * The counter is here to say whose record this is, and the switch beside it is
 * the app's one setting. That setting is not about what the counter looks like
 * — the wardrobe's job — but about who else gets to see it, which belongs here
 * for the same reason the drawing does: this is the page about you.
 *
 * The only other thing on the page that presses is inside the coins tile, and
 * it goes to the ledger. Everything else is a well, and wells go nowhere.
 */
function Record({
  stats,
  avatar,
  coins,
  unseen,
  onShow,
  onPush,
  onOpenLedger,
}: {
  stats: PlayerStats;
  avatar: AvatarResponse | null;
  /** The newest balance the menu knows, which may be fresher than `stats`. */
  coins: number;
  /** Something has been paid since the ledger was last opened. */
  unseen: boolean;
  onShow: (showBlob: boolean) => void;
  onPush: (push: boolean) => void;
  onOpenLedger: () => void;
}): React.JSX.Element {
  const rate =
    stats.totalPlayed > 0 ? Math.round((stats.totalHits / stats.totalPlayed) * 100) : 0;

  return (
    <div className="menu__panel">
      <div className="record__card block block--cream block--lg">
        {/* The counter stands in a slot cut into the block. Most accessories
            are moulded in cream and this block is cream, so without something
            cut behind it half the drawing is invisible on the one page that is
            about it. */}
        <span className="record__slot">
          <Blob
            face={avatar?.face}
            accessory={avatar?.accessory}
            size={COUNTER_SIZE.panel}
            fill="var(--counter-mine)"
            label="Your counter"
          />
        </span>
        <div className="record__side">
          <span className="record__title">This is you</span>
          {avatar?.canSave && <ShowBlob showBlob={avatar.showBlob} onShow={onShow} />}
          {avatar?.canSave && avatar.pushAvailable && (
            <PushSwitch push={avatar.push} onPush={onPush} />
          )}
        </div>
      </div>

      {/* Four figures rather than three, in pairs: the coin balance belongs
          beside the totals it is earned alongside, and a fourth tile in a
          three-up grid would sit on a row of its own looking like an
          afterthought. Every one of them is a well, because every one of them
          is already banked. */}
      <div className="figures figures--pairs">
        <div className="figure well">
          <span className="label label--felt">streak</span>
          <span className="figure__value">{stats.streak}</span>
        </div>
        <div className="figure well">
          <span className="label label--felt">best streak</span>
          <span className="figure__value figure__value--yellow">{stats.bestStreak}</span>
        </div>
        <div className="figure well">
          <span className="label label--felt">points</span>
          <span className="figure__value">{stats.points}</span>
        </div>
        {/* The one tile with something to press in it. Where a coin came from
            is a question about this number and no other, so the way to ask it
            is inside the well that holds it rather than a row of its own under
            the grid — and a small block standing in a well is the same shape
            the gift box's button already is. It sits on the balance's line, so
            the tile is no taller than the three beside it and the grid does not
            move. The dot rides on the button that answers it. */}
        <div className="figure figure--coins well">
          <span className="label label--felt">coins</span>
          <div className="figure__row">
            <span className="figure__value figure__value--orange">{coins}</span>
            {/* The visible words are the start of the accessible name rather
                than all of it: two of them are enough to press beside the
                balance, and not enough to hear on their own. */}
            <button
              type="button"
              className="button block block--cream block--sm figure__ledger"
              aria-label="Where from: what you have earned"
              onClick={onOpenLedger}
            >
              where from
              {unseen && <UnseenDot />}
            </button>
          </div>
        </div>
      </div>

      <div className="record__read block block--cream block--lg">
        <span className="label">how you read the room</span>
        {stats.totalPlayed > 0 ? (
          <p className="record__line">
            You have answered {stats.totalPlayed}{' '}
            {stats.totalPlayed === 1 ? 'question' : 'questions'} and come within{' '}
            {HIT_THRESHOLD} points on {stats.totalHits} of them. That is{' '}
            <strong>{rate}%</strong>.
          </p>
        ) : (
          <p className="record__line">
            Nothing to show yet. Answer a question and these start filling in.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Where the coins came from, and — when there are none — where they come from.
 *
 * A sheet laid over the whole menu rather than a block inside Your record. The
 * room it opens from is a page of totals the player already knew; this is the
 * one thing in the menu that tells them something they did not, and it earns
 * the interruption by being asked for. It also means the list of earns can be
 * as long as it needs to be without the room underneath giving up height for a
 * table nobody has opened.
 *
 * One way out, in the corner, and the same X that closes everything else.
 *
 * Two states, one sheet. A new player's ledger is empty, and an empty sheet is
 * a worse first impression than no sheet — so it teaches instead, mirroring the
 * `Nothing to show yet` branch `record__read` already has. Both tables read
 * their numbers from `shared/config.ts`, so neither can drift from what the
 * game actually pays.
 */
function Ledger({
  entries,
  onClose,
}: {
  entries: Earning[] | null;
  onClose: () => void;
}): React.JSX.Element {
  const earned = entries !== null && entries.length > 0;

  return (
    /* Labelled by its own heading rather than by a string repeated here, so a
       reader hears the same words a looker sees. */
    <div className="ledger" role="dialog" aria-modal="true" aria-labelledby="ledger-title">
      {/* The felt, dimmed. Pressing it closes, because a sheet that can only be
          dismissed from a 40px target in the corner is a sheet somebody is
          stuck under. */}
      <button
        type="button"
        className="ledger__scrim"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
      />

      <div className="ledger__sheet block block--cream block--lg">
        <div className="ledger__head">
          <span className="label" id="ledger-title">
            {earned ? 'what you have earned' : 'ways to earn'}
          </span>
          <button
            type="button"
            className="ledger__close"
            aria-label="Close"
            onClick={onClose}
          >
            <Cross />
          </button>
        </div>

        {entries === null ? (
          <p className="record__line">Loading...</p>
        ) : (
          <ul className="earnings__list">
            {earned
              ? entries.map((entry) => (
                  <EarnRow
                    // The timestamp is what makes a member unique in the ledger
                    // itself, so it is what identifies a row here too.
                    key={`${entry.at}:${entry.reason}`}
                    label={EARN_COPY[entry.reason](entry.detail)}
                    // The free roll pays a box rather than coins, and a row
                    // reading `+0` reads as a bug rather than as a gift.
                    amount={entry.reason === 'join' ? 'free box' : `+${entry.coins}`}
                  />
                ))
              : WAYS_TO_EARN.map((way) => (
                  <EarnRow key={way.label} label={way.label} amount={way.amount} />
                ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * What the game pays, in the order a player meets it.
 *
 * Every number is read from `config.ts` rather than typed here, which is the
 * whole point of the table: a rate that changes changes this screen with it.
 */
const WAYS_TO_EARN: readonly { label: string; amount: string }[] = [
  { label: 'turn up', amount: `+${COINS_FIRST_VOTE}` },
  { label: `every ${STREAK_BONUS_EVERY}th day in a row`, amount: `+${COINS_STREAK_BONUS}` },
  { label: 'post your comment', amount: `+${COINS_COMMENT}` },
  { label: 'upvotes on it', amount: `up to +${COMMENT_UPVOTE_COIN_CAP}` },
  { label: 'ask a question', amount: `+${COINS_SUBMISSION}` },
  { label: '...it becomes the Daily', amount: `+${COINS_PROMOTION}` },
  {
    label: `...every ${ROYALTY_VOTES_PER_COIN} people answer it`,
    // Asked of the rule rather than written down: what a hundredth answer pays
    // is `royaltyFor`'s answer and nothing else's.
    amount: `+${royaltyFor(ROYALTY_VOTES_PER_COIN)}`,
  },
];

/**
 * One line of the ledger: what happened on the left, what it paid on the right.
 *
 * The amount is `DM Mono`'s job in the stylesheet and the reason is body copy,
 * matching the wardrobe's item meta line — a column of numbers that do not line
 * up is a column nobody can read down.
 */
function EarnRow({ label, amount }: { label: string; amount: string }): React.JSX.Element {
  return (
    <li className="earnings__row">
      <span className="earnings__reason">{label}</span>
      <span className="earnings__amount">{amount}</span>
    </li>
  );
}

/**
 * Something has been paid since this player last looked.
 *
 * A dot, in the orange coins already carry on this page and in `BoxResult` —
 * deliberately not `--sun`, which is the streak and nothing else. It says
 * nothing about how much, because a dot that needed a number would be a badge.
 */
export function UnseenDot(): React.JSX.Element {
  return <span className="unseen-dot" aria-label="new earnings" role="img" />;
}

/**
 * Whether your counter stands in other people's crowds.
 *
 * One line of plain copy, because the thing it decides is not obvious from the
 * switch and is worth being unambiguous about: turning it off is retroactive.
 * It is a filter applied every time a crowd is drawn rather than a flag stamped
 * on a vote, so switching it off takes the counter out of questions answered
 * months ago as well as the next one.
 *
 * A switch rather than two buttons, because this is a setting being read as
 * often as it is changed, and a setting should show its state without being
 * pressed. The state is written out beside it as well: the knob's position is
 * the signal and the word is the confirmation, and neither is a colour.
 */
function ShowBlob({
  showBlob,
  onShow,
}: {
  showBlob: boolean;
  onShow: (showBlob: boolean) => void;
}): React.JSX.Element {
  return (
    <>
      {/* One line and a half, not the paragraph this was. The full version is
          on the reveal's first-run notice, which is where the player is
          actually told; what has to survive here is the half nobody could work
          out from the switch — that turning it off reaches backwards. */}
      <span className="record__note">
        Seen in other players&rsquo; crowds, old questions included.
      </span>
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={showBlob}
        aria-label="Show my counter to other players"
        onClick={() => onShow(!showBlob)}
      >
        <span className="switch__track" aria-hidden="true">
          <span className="switch__knob" />
        </span>
        <span className="switch__state" aria-hidden="true">
          {showBlob ? 'on' : 'off'}
        </span>
      </button>
    </>
  );
}

/**
 * Be told when the next Daily goes up.
 *
 * The second switch on the page and the same control as the first, which is the
 * whole reason it is here rather than in a room of its own: this is a setting
 * about you, on the page about you, next to the only other setting in the game.
 *
 * It is the opposite of `ShowBlob` in one respect and the copy has to carry it.
 * That one ships on and tells you so; this one ships off and stays off until it
 * is pressed, because a crowd cameo is a drawing inside an app somebody already
 * opened and this is the app reaching a phone in somebody's pocket. Absent
 * consent is no.
 *
 * It renders only when the plugin answered — see `pushAvailable`. A switch for
 * something that cannot be turned on is worse than no switch.
 */
function PushSwitch({
  push,
  onPush,
}: {
  push: boolean;
  onPush: (push: boolean) => void;
}): React.JSX.Element {
  return (
    <>
      {/* A promise the code has to keep, and it is made twice: here, and in
          `PushNotice` on the reveal, which is the fuller version because it is
          where the player says yes. If a second trigger is ever added, both
          lines change in the same commit or both are a lie. */}
      <span className="record__note">
        One notification a day, when the new question goes up.
      </span>
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={push}
        aria-label="Tell me when the new question is up"
        onClick={() => onPush(!push)}
      >
        <span className="switch__track" aria-hidden="true">
          <span className="switch__knob" />
        </span>
        <span className="switch__state" aria-hidden="true">
          {push ? 'on' : 'off'}
        </span>
      </button>
    </>
  );
}

/**
 * The counter you are making, and the two layers it is made of.
 *
 * A counter is a face with an accessory over it, so the wardrobe is that same
 * pair of layers with a way to step through each — the face above, the
 * accessory below, in the order they stack. Everything is on one screen at one
 * time: the grid this replaced put nine tiles under nine more and made choosing
 * an accessory a scroll away from seeing what it looked like on.
 *
 * There is no save button and no confirm. Stepping *is* equipping, and the
 * counter at the top re-seating itself is the whole receipt — this is a two-tap
 * game and the wardrobe should not be the heaviest screen in it.
 *
 * Rarity is the colour of the accessory's own bottom face and the word beside
 * the count. It appears on this screen and no other.
 */
function Wardrobe({
  avatar,
  onEquip,
  onOpened,
}: {
  avatar: AvatarResponse | null;
  onEquip: (next: Equipped) => void;
  onOpened: (box: BoxResponse) => void;
}): React.JSX.Element {
  return (
    /* The wrapper is unconditional so the room keeps its shape while the pair
       is in flight — a room that re-lays-out the moment the counter arrives
       moves everything under the reader. */
    <div className="wardrobe">
      <h1 className="screen__title">Your counter</h1>

      {avatar === null ? (
        <p className="notice notice--quiet notice--spaced">Loading...</p>
      ) : (
        <>
          <div className="wardrobe__preview">
            {/* The tip rides on this wrapper rather than on the drawing.
                The drawing carries a drop shadow, and an element that is both
                filtered and the target of an animation is the one shape a
                browser is liable to rasterise into a rectangle — which is a
                soft dark box around your counter every time you step it.
                Keyed on the pair, so the tip still replays on a swap. */}
            <span className="wardrobe__tip" key={`${avatar.face}:${avatar.accessory}`}>
              <Blob
                face={avatar.face}
                accessory={avatar.accessory}
                size={COUNTER_SIZE.wardrobe}
                fill="var(--counter-mine)"
                label={`Your counter: ${resolveFace(avatar.face).name}, ${resolveAccessory(
                  avatar.accessory
                ).name}`}
              />
            </span>
          </div>

          {!avatar.canSave && (
            <p className="notice notice--quiet notice--spaced">
              Sign in to change your counter.
            </p>
          )}

          {/* The steppers walk what this player owns and nothing else, using
              the same rule the equip endpoint enforces. A ring that includes
              items the server will refuse is a ring where most steps do
              nothing. */}
          <div className="wardrobe__layers">
            <Layer
              kind="face"
              items={ownedItems(FACES, avatar.owned)}
              current={avatar.face}
              locked={!avatar.canSave}
              onPick={(id) => onEquip({ face: id, accessory: avatar.accessory })}
            />
            <Layer
              kind="accessory"
              items={ownedItems(ACCESSORIES, avatar.owned)}
              current={avatar.accessory}
              locked={!avatar.canSave}
              onPick={(id) => onEquip({ face: avatar.face, accessory: id })}
            />
          </div>

          {avatar.canSave && <GiftBox avatar={avatar} onOpened={onOpened} />}
        </>
      )}
    </div>
  );
}

/**
 * The box, and the one moment in this room.
 *
 * It sits under the layers because it is what fills them: the reader sees what
 * they have, then the way to have more. A well, because what it holds is a
 * count of what you already own — and exactly two rows, always, because this
 * room has a height budget and the bottom of it is a button that has to stay
 * pressable without scrolling. The result takes the status row's place rather
 * than pushing it down, and the shortfall is spoken by the button itself rather
 * than by a notice under it.
 */
function GiftBox({
  avatar,
  onOpened,
}: {
  avatar: AvatarResponse;
  onOpened: (box: BoxResponse) => void;
}): React.JSX.Element {
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState<BoxResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A free roll is spent before coins are, on the server and therefore here.
  const free = avatar.freeRolls > 0;
  const affordable = free || avatar.coins >= BOX_PRICE;

  async function open(): Promise<void> {
    setOpening(true);
    setError(null);
    try {
      const box = await openBox();
      setResult(box);
      onOpened(box);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The box would not open.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="box well">
      {/* The head is one fixed slot whichever state it is in. A result is
          taller than the status line it replaces, and a box that grew by fifty
          pixels the moment it was opened pushed its own button down onto the
          way out of the room. */}
      <div className="box__head">
        {result ? (
          <BoxResult result={result} avatar={avatar} />
        ) : (
          <div className="label label--felt label-row">
            <span>gift box</span>
            {/* The price line says what the next tap costs, and a free roll is
                what it costs. The catalogue count moves to the result row,
                where it always was on the other side of a press. */}
            <span>
              {free
                ? `${avatar.freeRolls} free ${avatar.freeRolls === 1 ? 'roll' : 'rolls'}`
                : `you own ${avatar.owned.length} of ${ITEMS.length}`}
            </span>
          </div>
        )}
      </div>

      <button
        type="button"
        className="button block block--orange block--md box__open"
        disabled={!affordable || opening}
        onClick={() => void open()}
      >
        {opening
          ? 'Opening...'
          : free
            ? `${result ? 'Open another' : 'Open a box'} — free`
            : affordable
              ? `${result ? 'Open another' : 'Open a box'} · ${BOX_PRICE}`
              : `${BOX_PRICE - avatar.coins} coins short`}
      </button>

      {error && <p className="notice notice--quiet notice--spaced">{error}</p>}
    </div>
  );
}

/**
 * What came out, on one row, standing exactly where the status line it replaced
 * stood.
 *
 * The rarity ladder is the block's own colour here — the one exception to
 * everything else in this app meaning one thing per colour, kept an exception
 * by never leaving this screen. A duplicate says so in the same row rather than
 * adding one, because a room with a height budget cannot afford a section that
 * grows when something happens in it.
 *
 * Keyed on the item and the balance together, so opening two of the same
 * duplicate in a row still replays the moment rather than sitting still.
 */
function BoxResult({
  result,
  avatar,
}: {
  result: BoxResponse;
  avatar: AvatarResponse;
}): React.JSX.Element {
  // An id the catalogue no longer has is not a crash: it is a box opened across
  // a deploy that removed an item, and the receipt still has to render.
  const item = findItem(result.item);
  if (!item) {
    return (
      <p className="notice notice--quiet" key={`${result.item}:${result.coins}`}>
        Something came out, but the wardrobe does not know what it is.
      </p>
    );
  }

  return (
    <div
      className={`box__result block box__result--${item.rarity}`}
      key={`${result.item}:${result.coins}`}
      role="status"
    >
      <span className="box__result-head">
        <span className="box__result-name">{item.name}</span>
        {/* A free roll has no refund line to show, because it took nothing in.
            Everything else about the receipt is the same one a paid box gets. */}
        <span className="box__result-meta">
          {item.rarity} ·{' '}
          {result.duplicate
            ? result.free
              ? 'duplicate'
              : `duplicate · +${result.refunded} coins`
            : 'new'}
        </span>
      </span>
      <span className="box__result-count">
        {avatar.owned.length} of {ITEMS.length}
      </span>
    </div>
  );
}

/**
 * One layer, and the two arrows that walk it.
 *
 * The row is a cream block and the arrows are yellow blocks sitting on it. The
 * row itself does not press — only the arrows do, and a block that looks
 * pressable and is not is the one lie this system can tell.
 *
 * The count is spelled out beside the rarity because the arrows alone say
 * nothing about how far there is to go. It counts what you *own* now, so it
 * grows as boxes are opened — how big the catalogue is is the box's line to
 * deliver, once, rather than a reproach attached to both steppers.
 */
function Layer({
  kind,
  items,
  current,
  locked,
  onPick,
}: {
  kind: string;
  items: readonly Item[];
  current: string;
  locked: boolean;
  onPick: (id: string) => void;
}): React.JSX.Element {
  const item = items[itemIndex(items, current)]!;
  // One item is a ring with nowhere to go. The arrows say so rather than
  // offering a press that lands back where it started.
  const stuck = locked || items.length < 2;

  return (
    <div className="stepper block block--cream block--md">
      <button
        type="button"
        className="button block block--yellow stepper__arrow"
        aria-label={`Previous ${kind}`}
        disabled={stuck}
        onClick={() => onPick(stepItem(items, current, -1).id)}
      >
        <Chevron back />
      </button>

      {/* Announced as one string on change, so a reader hears "Wink, face,
          rare, 7 of 8" rather than four separate updates racing each other.

          Which layer this is used to be a line of its own above the stepper. It
          moved into the meta because the room has a height budget and that line
          was a whole row per layer to carry one word — and the word is the least
          of what this line says. */}
      <span className="stepper__pick" aria-live="polite">
        <span className="stepper__name">{item.name}</span>
        <span className={`stepper__meta stepper__meta--${item.rarity}`}>
          {kind} · {item.rarity} · {itemIndex(items, current) + 1} of {items.length}
        </span>
      </span>

      <button
        type="button"
        className="button block block--yellow stepper__arrow"
        aria-label={`Next ${kind}`}
        disabled={stuck}
        onClick={() => onPick(stepItem(items, current, 1).id)}
      >
        <Chevron back={false} />
      </button>
    </div>
  );
}

/**
 * The arrows, drawn rather than typed.
 *
 * The bundled fonts are subsetted to the Latin ranges they need, so an arrow
 * glyph would fall through to whatever the device happens to have. A stroked
 * path is two lines of markup and always the same shape.
 */
function Chevron({ back }: { back: boolean }): React.JSX.Element {
  return (
    <svg className="chevron" viewBox="0 0 12 20" width="12" height="20" aria-hidden="true">
      <path
        d={back ? 'M 9.5 3 L 2.5 10 L 9.5 17' : 'M 2.5 3 L 9.5 10 L 2.5 17'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Players by points banked, weekly by default. */
function Board(): React.JSX.Element {
  return (
    <div className="menu__panel">
      <h1 className="screen__title">Who&rsquo;s ahead</h1>
      <PlayerBoard />
      <Footnote>
        Every question you answer pays points, whether it is the Daily, an open question or
        something out of the archive. The weekly board clears every Monday at midnight UTC.
        All time never clears.
      </Footnote>
    </div>
  );
}

/**
 * Ask the subreddit something.
 *
 * The one room that ends with a public post under the player's own name, and the
 * only screen in the app that asks anybody to type. Four things follow.
 *
 * **It fits on the screen.** Every field, the preview and the button are visible
 * at once, at the 512px the inline post view can be — the same budget the
 * wardrobe is built to. Every box here is a fixed height for that reason. The
 * question wraps inside its own, because it is the one field somebody writes a
 * sentence into; the three short ones stay single lines that scroll sideways.
 * What none of them do is grow, because a room that reflows as you type moves
 * the button you are reaching for.
 *
 * **Four fields, in the order they are read**, and only the first is work: the
 * answers arrive as Yes/No the way the Devvit form's do, and the title defaults
 * to the question. All four count down to their own limit on the label's line,
 * so a limit is something you watch arrive rather than something you are told
 * about after you have written past it.
 *
 * **One primary button, and the room is the confirm.** Nothing here submits on
 * blur or on the last keystroke. The wardrobe can afford to save as it goes
 * because the way to undo the wardrobe is to press the other arrow; there is no
 * other arrow for a post.
 *
 * **The client's validation is a courtesy.** Every rule below is re-run on the
 * server before anything is created, and that is the gate — this copy exists to
 * say why the button is inert, not to decide whether the question is allowed.
 */
function Ask({ canSubmit }: { canSubmit: boolean }): React.JSX.Element {
  const [text, setText] = useState('');
  const [labelA, setLabelA] = useState('Yes');
  const [labelB, setLabelB] = useState('No');
  const [title, setTitle] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = validateSubmission(text, labelA, labelB, title);
  // Silent until they have started. A form that objects to being empty is
  // objecting to being opened.
  const started = text.trim().length > 0;
  const ready = canSubmit && check.ok && !posting;

  async function post(): Promise<void> {
    setPosting(true);
    setError(null);
    try {
      const posted = await submitQuestion({ text, labelA, labelB, title });
      // Straight to the post. `posting` is deliberately left set: the button has
      // done its one job and must not spring back to life behind a navigation.
      navigateTo(new URL(posted.permalink, REDDIT_ORIGIN).toString());
    } catch (failure) {
      // The server's words, whatever they were — the allowance, the filter, or a
      // question already on its way up. It is the honest version and it is the
      // only one that knows which of the three happened.
      setError(failure instanceof Error ? failure.message : 'That did not post.');
      setPosting(false);
    }
  }

  return (
    <div className="menu__panel">
      <h1 className="screen__title">Ask the room</h1>
      <p className="screen__lede">
        The good ones split the room and take two words to answer. Yours joins the pile the
        moderators pick tomorrow&rsquo;s question from.
      </p>

      {!canSubmit && (
        <p className="notice notice--spaced">
          Sign in to post a question. The rest of the menu works either way.
        </p>
      )}

      <div className="ask block block--cream block--lg">
        {/* The one field somebody writes a sentence into, so it is the one
            that wraps. Its height is fixed rather than grown to fit: the box
            holds the whole of what it accepts at most sizes and scrolls the
            last line at the shortest, which is the trade that keeps the button
            below from moving out from under a thumb mid-sentence. */}
        <Field
          id="ask-text"
          label="the question"
          hint={`${text.length} / ${SUBMITTED_QUESTION_MAX_LENGTH}`}
        >
          <textarea
            id="ask-text"
            className="ask__input ask__input--wrap well--cut"
            maxLength={SUBMITTED_QUESTION_MAX_LENGTH}
            value={text}
            placeholder="Do you eat the pizza crust?"
            disabled={!canSubmit}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>

        <div className="ask__pair">
          <Field
            id="ask-a"
            label="first answer"
            hint={`${labelA.length} / ${SUBMITTED_LABEL_MAX_LENGTH}`}
          >
            <input
              id="ask-a"
              className="ask__input well--cut"
              type="text"
              maxLength={SUBMITTED_LABEL_MAX_LENGTH}
              value={labelA}
              disabled={!canSubmit}
              onChange={(event) => setLabelA(event.target.value)}
            />
          </Field>
          <Field
            id="ask-b"
            label="second answer"
            hint={`${labelB.length} / ${SUBMITTED_LABEL_MAX_LENGTH}`}
          >
            <input
              id="ask-b"
              className="ask__input well--cut"
              type="text"
              maxLength={SUBMITTED_LABEL_MAX_LENGTH}
              value={labelB}
              disabled={!canSubmit}
              onChange={(event) => setLabelB(event.target.value)}
            />
          </Field>
        </div>

        {/* The placeholder is the question as it stands, so the field reads as a
            refinement of something that already works rather than as a fifth
            thing to invent. */}
        <Field
          id="ask-title"
          label="post title (optional)"
          hint={`${title.length} / ${TITLE_MAX_LENGTH}`}
        >
          <input
            id="ask-title"
            className="ask__input well--cut"
            type="text"
            maxLength={TITLE_MAX_LENGTH}
            value={title}
            placeholder={text || 'Leave this blank to use the question.'}
            disabled={!canSubmit}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
      </div>

      <AskPreview text={text} labelA={labelA} labelB={labelB} title={title} />

      <button
        type="button"
        className="button block block--orange block--lg ask__post"
        disabled={!ready}
        onClick={() => void post()}
      >
        {posting ? (
          'Posting...'
        ) : (
          <>
            Post it<CoinTag coins={COINS_SUBMISSION} />
          </>
        )}
      </button>

      {error ? (
        <p className="notice notice--quiet notice--spaced">{error}</p>
      ) : (
        started && !check.ok && <p className="notice notice--quiet notice--spaced">{check.reason}</p>
      )}
    </div>
  );
}

/**
 * One labelled field, with a counter on the label's line if it has a limit.
 *
 * The counter shares the label's line rather than taking one under the box: this
 * room has a height budget, and four hints on four rows of their own would be a
 * quarter of it spent on arithmetic.
 */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="ask__field">
      <div className="label label-row">
        <label htmlFor={id}>{label}</label>
        {hint !== undefined && <span>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * The post as it will appear, which is the part nobody can take back.
 *
 * A well cut into the felt: it is the one block in this room that is not a
 * control, and the difference has to be visible before the button is pressed.
 *
 * It resolves the title the same way the server does — `normalizeTitle` with the
 * question as the fallback — so an untouched title field shows what it will
 * actually post rather than an empty line.
 */
function AskPreview({
  text,
  labelA,
  labelB,
  title,
}: {
  text: string;
  labelA: string;
  labelB: string;
  title: string;
}): React.JSX.Element {
  const shown = normalizeTitle(title, text);

  return (
    <div className="ask__preview well">
      <span className="label label--felt">how it will look</span>
      <span className="ask__preview-title">{shown || 'Your title goes here.'}</span>
      <p className="ask__preview-text">{text || 'The question goes here.'}</p>
      <div className="ask__preview-answers">
        <span className="ask__preview-answer">{labelA}</span>
        <span className="ask__preview-answer">{labelB}</span>
      </div>
    </div>
  );
}
