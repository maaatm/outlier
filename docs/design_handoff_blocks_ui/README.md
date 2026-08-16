# Handoff: Outlier — "Blocks" UI replacement

## Overview

Replace the entire visual layer of Outlier (`maaatm/outlier`, branch `main`, client at `src/client`) with a new system called **Blocks**. Same game, same information architecture, same routes and components — new surface language, new type, new colour.

Today's UI is a white card with 2px ink borders and hard offset shadows on a lavender page. Blocks throws that away: the app is a **green felt table**, and every piece of UI on it is a moulded plastic game piece with a solid bottom face. Nothing has an outline. Depth does all the work that borders used to do.

Nothing about the game logic changes. Do not touch `shared/points.ts`, `shared/badges.ts`, `shared/items.ts`, `shared/config.ts`, or any server code except where a screen needs a value it already computes.

## About the design files

The files in this bundle are **design references written as HTML** — prototypes of the intended look, not production code to copy.

- `Outlier - Redesign Drafts.dc.html` — the reference. It contains several exploration turns; **only the last two matter**:
  - **Turn 5 (`id="5a"`, top of file)** — share slide, leaderboard, Your record, Ask a question, wardrobe with a box opened, desktop leaderboard.
  - **Turn 4 (`id="4a"`, directly below turn 5)** — question, guess, reveal crowd, reveal score, menu, wardrobe, desktop question, desktop reveal score.
  - Everything below turn 4 (turns 3, 2, 1) is **rejected exploration**. Ignore it. Do not lift values from it.
- `Outlier - Current UI.dc.html` — a faithful recreation of today's shipping UI, for before/after comparison and for copy that must not change.
- `support.js` — the runtime the reference files need in order to open in a browser. Not part of the deliverable.

Open the reference in a browser and read the values off the markup: it is inline-styled, so every colour, radius, shadow and font size is right there on the element. Each frame carries a `data-screen-label` (`4a-01 Question`, `5a-08 Leaderboard`, …) matching the screen names below.

**Recreate these designs in the existing React + CSS codebase**, using its established structure: `styles.css` holds the design tokens and every class; components consume classes, not inline styles. Keep that discipline — this is a rewrite of `styles.css` plus the markup changes each screen needs, not a move to inline styles or a new styling library.

## Fidelity

**High-fidelity.** Colours, type, radii, shadows, spacing and copy are final. Match them. Two things are deliberately left to your judgement:

1. Exact pixel spacing may be adjusted to fit the real viewport range (Devvit's inline post view goes down to 512px tall — the current `styles.css` comments document this; those constraints still bind).
2. Counter (crowd dot) geometry is already correct in the codebase — keep `crowdLayout.ts` and `jitter.ts` as they are and restyle the dots.

---

## The system

Three surfaces. Every element on every screen is one of them. If something doesn't fit, it is wrong.

### 1. Block — pressable, or holds something awarded

A solid moulded piece: flat fill, no border, and a **bottom face** in a darker shade of its own colour, drawn as a hard-edged shadow with a soft drop shadow behind it.

```css
/* the pattern, at three thicknesses */
box-shadow: 0 5px 0 <face>, 0 10px 13px rgba(10, 40, 25, 0.2);   /* small: rows, chips */
box-shadow: 0 6px 0 <face>, 0 12px 16px rgba(10, 40, 25, 0.24);  /* medium: cards, buttons */
box-shadow: 0 8px 0 <face>, 0 16px 20px rgba(10, 40, 25, 0.24);  /* large: hero cards, primary CTA */
```

Fill / face pairs — these four are the whole palette of blocks:

| Block | Fill | Bottom face | Text on it |
|---|---|---|---|
| Cream (default surface) | `#FFF6E7` | `#CBB795` | `#22301F` |
| Yellow (primary action, streak, "your bucket") | `#FFC93C` | `#C48D12` | `#22301F` |
| Orange (destructive-free primary, "you", the minority) | `#FF7A2F` | `#BF5215` | `#FFF6E7` |
| Violet (rarity: rare — wardrobe only) | `#8b5cf6` | `#6D3EE0` | `#FFF6E7` |

Radius: `8px` small, `10–11px` medium, `12px` hero. Never fully round; a block is a moulded square-cornered piece.

### 2. Well — cut into a surface, never pressable

Recessed: a darker translucent fill plus an inward shadow, no bottom face.

```css
/* cut into the felt — holds numbers you have earned, lists, charts */
background: rgba(8, 42, 25, 0.30);
box-shadow: inset 0 3px 5px rgba(8, 42, 25, 0.5);
border-radius: 9px;          /* 7–8px on header pills, 10–11px on large panels */

/* header pills, small chips */
background: rgba(8, 42, 25, 0.32);
box-shadow: inset 0 2px 3px rgba(8, 42, 25, 0.5);

/* a secondary/ghost button is a well you may press: same recipe, 0.28 alpha */
background: rgba(8, 42, 25, 0.28);
box-shadow: inset 0 2px 4px rgba(8, 42, 25, 0.5);

/* cut into a cream block — this is what a TEXT INPUT is */
background: rgba(34, 48, 31, 0.09);
box-shadow: inset 0 2px 4px rgba(34, 48, 31, 0.2);
border-radius: 8px;
```

Rules that fall out of this and must hold everywhere:

- **A number you have earned sits in a well. A number being awarded to you sits on a block.** Streak, points, coins, days played, "you said / it was / off by" → wells. "+40", the badge, a box result → blocks.
- **An input is a well cut into a block, never into the felt.** Felt wells are inert; block wells take text.
- **A selected tab is a pressed block**: it loses its bottom face and gains the inset shadow. Selection is depth, not colour.
- **Rarity speaks through the bottom face** and the word beside the count: common `#8b93a1`, uncommon `#0f9bbd`, rare `#8b5cf6` (face `#6D3EE0`). It appears in the wardrobe and nowhere else — that stays true.

### 3. Felt — the page

`#2E9E6B`, edge to edge, no card wrapper. Screen titles and body copy sit **directly on the felt** in cream (`#FFF6E7`, muted at `rgba(255,246,231,.75)`); they are not inside a card. This is the biggest structural change from today's UI: **delete the white `.card` that currently wraps every screen.** The header is on the felt, the content is on the felt, and blocks are placed on top.

### Counters (the crowd)

The hundred dots become plastic counters tipped onto the table.

```css
border-radius: 50%;
background: #FFF1DA;                 /* neutral crowd */
box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.16), 0 4px 7px rgba(18, 32, 24, 0.32);
rotate: <±14deg, seeded per index>;   /* the only tilted thing in the UI */
```

- Camps: your camp `#FF7A2F`, the other camp `#FFF1DA`. On the guess screen the live preview of your guess uses yellow `#FFC93C` for "with you" and cream for the rest.
- Faces: eyes are `#3A2A18` discs, `13%` of the counter, at `top: 32% / left: 24% / right: 24%`, on roughly 16% of counters (seeded, same rate as today).
- **Your** counter gets a `0 0 0 3px #FFFFFF` ring (`#FFC93C` where it sits in a well, e.g. the leaderboard) and is raised in z-order.
- Counters overlap and are tilted; the pack bleeds past the screen's horizontal padding (the reference uses `margin: 0 -20px` on phone, `-34px` on desktop). Keep the existing seeded layout — only the paint changes.

### Type

Two families, both from Google Fonts (add to the client's font loading; the four bundled woff2 files in `src/client/fonts` are no longer used by this design — Gabarito, Instrument Sans and DM Mono all leave the app).

- **Lilita One** — display, always uppercase, `letter-spacing: .01–.04em`. Every number you read at a glance, every button label, every screen title, the wordmark.
  - wordmark 22px phone / 26px desktop · screen title 40–58px · question 33px (question screen), 20px (compressed strip), 46px desktop · hero number 52–66px · stat number 30–36px · button 16–29px.
- **Space Grotesk** — everything else.
  - `700`, `9–10px`, `letter-spacing: .14–.20em`, uppercase, at `rgba(255,246,231,.55–.6)` on felt or `rgba(34,48,31,.45–.5)` on cream → **all labels**. This is the workhorse; today's DM Mono labels become this.
  - `400/500`, `11–13.5px`, `line-height: 1.5–1.6` → body copy, names, meta.
- No mono anywhere. No italics. `text-wrap: pretty` on the long question.

---

## Screens

Every phone frame is 400×780 with `padding: 20px`; every desktop frame is 1180×720 with `padding: 26px 34px`. Header is the same on all of them: wordmark (or a Space Grotesk 700 uppercase screen label when you are inside the menu) on the left, one or two well-pills on the right holding `streak` and `pts` — label in Space Grotesk 700 9.5px, value in Lilita One 15px (yellow `#FFC93C` for streak, cream for points).

Screen names below match `data-screen-label` in the reference. Repo paths are from the current `## Screen map` in `github.md`.

### 01 Question — `4a-01 Question` · `App.tsx` (PlayView), `components/DotCrowd.tsx`
Header → cream block (medium shadow, radius 8) holding label `DAILY · 15 AUG 2026` and the question in Lilita One 33px/1.04 → counters filling the slack, bleeding to the screen edges → two big answer blocks in a 2-column grid, `gap: 13px`, `min-height: 92px`, Lilita One 29px: **Yes** yellow, **No** orange. The wobble rule under the question (`components/WobbleRule.tsx`) is gone — delete it; the block's bottom face is the separator now.

### 02 Guess — `4a-02 Guess` · `App.tsx` (PlayView), `colors.ts`
Header → compressed question strip (cream block, 20px Lilita, radius 8, small shadow) → counters, live-tinted yellow/cream at the current guess → cream block: label `YOU SAID YES — HOW MANY OUT OF 100 AGREE?`, the guess in Lilita One 56px with `OUT OF 100` beside it, then the slider → yellow **Lock it in** block (18px padding, Lilita 24px) → **Change answer** as a well-button, centred, Space Grotesk 700 11px.

Slider, replacing `.slider`: a 12px well cut into the cream block (`rgba(34,48,31,.14)`, inset `0 2px 3px rgba(34,48,31,.32)`, radius 6), a yellow fill to the left of the thumb, and a **32×32 orange block thumb** (radius 8, `box-shadow: 0 5px 0 #BF5215`). The thumb stays upright — it never rotates. Ticks `0` / `100` in Space Grotesk 700 10px.

### 03 Reveal · crowd — `4a-03 Reveal crowd` · `App.tsx` (RevealView), `crowdLayout.ts`, `jitter.ts`
Header → question strip → counters swept into two piles → cream block with the result: `19` in Lilita One 52px orange, `OUT OF 100 WITH YOU` beside it, and `19 Yes · 81 No · 2412 votes today` in Space Grotesk 500 12px → nav row.

Nav (`.slides__nav`): the three round dots become three **22×7 bars**, radius 3 — cream for the current slide, `rgba(8,42,25,.3)` for the others. Back is a well-button, Next is a yellow block, both 88–96px wide.

### 04 Reveal · score — `4a-04 Reveal score` · `App.tsx` (PointsAward), `components/BadgeStamp.tsx`, `components/Histogram.tsx`
Header → an 86px strip of just your camp's 19 counters → three felt wells in a 3-column grid (`you said 25` cream / `it was 19` orange / `off by 6` yellow; label Space Grotesk 700 9px, value Lilita One 30px) → **yellow block** with `Sharp` (Lilita 22px) + `+40` (Lilita 34px) and the breakdown line beneath → **orange block** with the badge name (Lilita 21px) and its sentence → histogram in a felt well → nav row.

Histogram bars: `border-radius: 3px`, `background: rgba(255,246,231,.5)` with `inset 0 -3px 0 rgba(8,42,25,.22)` as their bottom face; your bucket is yellow with `inset 0 -4px 0 #C48D12`. Axis `0` / `100`, Space Grotesk 700 9px. `BadgeStamp`'s rotate-and-stamp animation is replaced (see Motion).

### 05 Menu — `4a-05 Menu` · `components/Menu.tsx` (Root, DailyAction)
Header (label `MENU`) → hero cream block: wordmark in Lilita One 58px + the tagline in Space Grotesk 400 13px → orange **Today's question** block (19px padding, Lilita 25px) → four cream row-blocks (`gap: 12px`, radius 9, small shadow) each with title in Lilita One 19px and its one-line description in Space Grotesk 500 11px → **Back to the question** well-button pinned to the bottom. Copy is unchanged from today.

### 06 Wardrobe — `4a-06 Wardrobe` · `components/Menu.tsx` (Wardrobe, Layer, GiftBox), `components/Blob.tsx`
Header (label `WARDROBE`, coins well) → `Your counter` title on the felt, Lilita One 40px → the counter, 172px, centred, orange with `inset 0 -7px 0 rgba(0,0,0,.16), 0 12px 20px rgba(10,40,25,.34)`; accessory pieces are drawn as blocks around/over it (the reference shows bunny ears as two 28×74 cream rounded blocks at ±10°, and a visor as a 128×36 violet block across the top) → two cream stepper rows: 40×40 **yellow block** arrows (`0 4px 0 #C48D12`, Lilita 19px chevrons), name in Lilita One 20px, meta in Space Grotesk 700 9.5px (`FACE · UNCOMMON · 5 OF 6`) → gift box in a felt well: status line + orange **Open a box · 30** block → **Back to menu** well-button.

`Blob.tsx` currently draws the head, accessory and face as one SVG. Keep it one component, but the head becomes a plain circle with the counter's inset bottom face, and each accessory becomes a block — so accessories are rectangles with a bottom face, not outlined SVG paths. Rarity colour lives on the accessory's face and in the meta line.

### 07 Reveal · share — `5a-07 Reveal share` · `App.tsx` (RevealView), the compose slide
Header → question strip → 19-counter strip → cream block containing: label `YOUR COMMENT` + the generated comment in a **block well** (Space Grotesk 500 12.5px/1.6, the numbers bolded to 700 `#22301F`), then label `ADD A LINE — OPTIONAL` + the note field as a second block well (min-height 46px, 13px/1.5), then a footer row `POSTS TO TODAY'S THREAD` / `52 / 240` → orange **Post comment** block → cream **Copy result** block → nav row with the third bar active, Back and Menu as well-buttons.

`.compose__preview` and `.compose__note` both become block wells; the growing-textarea behaviour stays exactly as documented in `styles.css` today.

### 08 Leaderboard — `5a-08 Leaderboard`, `5a-D8 Leaderboard` · `components/Menu.tsx` (PlayerBoard)
Header (label `LEADERBOARD`, pts well) → `Who's ahead` title on felt, Lilita One 44px → two tabs, equal width, `gap: 10px`: **This week** a yellow block, **All time** a pressed well — swap which is which on selection → the board in one tall felt well: rows on a `26px 28px 1fr auto` grid, `gap: 13px` — rank in Space Grotesk 700 12px at 50% cream, a 28px counter as the avatar (fill varies: cream / orange / yellow, `inset 0 -3px 0 rgba(0,0,0,.14–.18)`), name in Space Grotesk 500 14px, points in Lilita One 19px → your own row pinned at the bottom of the same well, above a `2px solid rgba(255,246,231,.22)` rule: rank and points in yellow, the counter ringed `0 0 0 3px #FFC93C`, name replaced by the label `YOU` → **Back to menu** well-button.

Desktop: the same well splits into two side-by-side wells (ranks 1–6 and 7–11 in the reference), your row pinned to the bottom of the right-hand one. Tabs move up into the header row.

### 09 Your record — `5a-09 Your record` · `components/Menu.tsx` (Record), `Blob.tsx`
Header → cream block: your 76px counter on the left, and on the right `You, on the table` (Lilita One 22px), the explanatory line (Space Grotesk 500 11.5px), and the switch → four felt wells in a 2×2 grid (`days played 63`, `best streak 11` yellow, `average miss 9`, `outlier days 22` orange) → cream block `HOW YOU READ THE ROOM` with the summary sentence (Space Grotesk 500 13.5px, key number bolded) → felt well `LAST SEVEN DAYS / 5 PLAYED` with a seven-bar strip, today yellow, unplayed days at `rgba(255,246,231,.22)` with no bottom face → **Back to menu** well-button.

Switch, replacing `.switch`: a 48×28 well (`rgba(34,48,31,.12)`, inset `0 2px 4px rgba(34,48,31,.28)`, radius 14) with a **22×22 orange block knob** (radius 6, `0 3px 0 #BF5215`) that slides 22px. State is also written next to it as `ON` / `OFF` in Space Grotesk 700 10px — colour is never the only channel.

### 10 Ask a question — `5a-10 Ask` · `components/Menu.tsx` (Ask/Compose)
Header → `Ask the room` title on felt, Lilita One 40px → guidance paragraph on the felt (Space Grotesk 500 12.5px, max-width 320px) → cream block holding four fields, each a label row (Space Grotesk 700 9.5px + character counter, right-aligned) above a block well: the question (full width, one line, ellipsised), `yes means` / `no means` side by side, and an optional note for the mods → felt well `HOW IT WILL LOOK` previewing the question in Lilita One 19px with the two answer labels as flat `rgba(255,246,231,.16)` chips → orange **Post it** block → **Back to menu** well-button.

Keep the current one-line-input decision and its reasoning (it is documented at `.ask__input` in `styles.css`) — the fields are single-line boxes that scroll horizontally, not growing textareas.

### 11 Wardrobe · box opened — `5a-11 Wardrobe opened` · `components/Menu.tsx` (GiftBox)
Same as screen 06, with three differences: the coins well shows the debited balance, the new accessory is worn by the counter, and the gift box's status line is **replaced in place** by a violet block (`#8b5cf6` / face `#6D3EE0`) holding the item name (Lilita One 18px), `RARE · NEW · NOW WORN` (Space Grotesk 700 9px), and the collection count on the right. The button relabels to `Open another · 30`. The well is exactly two rows in every state — a duplicate shows `DUPLICATE · +12 COINS` in the same row rather than adding one.

### Desktop — `4a-D1 Question`, `4a-D4 Reveal score`, `5a-D8 Leaderboard`
No sidebar, no new navigation: the table simply gets wider and blocks keep their thickness. Question screen: question block pinned left at `max-width: 720px`, counters full-bleed, two 104px answer blocks. Score screen: a `520px 1fr` grid — counters, stat wells, award and badge stack on the left, histogram well and nav on the right. Type steps up roughly 15–25%; shadow thickness goes from 6px/8px to 7px/9px. Everything else is identical.

---

## Interactions & motion

Replace today's hover-lift/sticker-peel idiom entirely. Blocks are rigid: they move down and up, they never scale, never rotate, never fade.

- **Press** (every block): translate down by its own bottom-face height (e.g. 8px → 0) over **70ms**, shrinking the bottom face to match, and shrink the drop shadow with it. Release springs back over **140ms**, `cubic-bezier(0.22, 1.18, 0.36, 1)`. Nothing else changes.
- **Hover** (fine pointer only, as today): raise 2px and lengthen the drop shadow. No colour change.
- **Wells never move.** Numbers inside them count up; the well is fixed. This is the whole affordance rule and it is worth being strict about.
- **Answer → guess:** the unchosen answer block drops flat into the felt and disappears beneath it; the chosen one slides up to become the compressed question strip while the counters re-tint to your camp.
- **Slider drag:** the thumb stays upright; the yellow fill and the crowd re-tint live, in whole counters, with no easing on the count.
- **Reveal:** counters sweep into two piles, staggered **8ms per counter, ~420ms total**, then the result block lands from above with a single **60ms** overshoot — one thud, not a bounce sequence. This is the one orchestrated moment in the app; everything else is a press.
- **Award:** the yellow `Sharp` block slides in from the left; the badge block drops onto it 120ms later. `BadgeStamp`'s rotation-and-scale stamp goes away — a block does not stamp, it lands. Histogram bars grow from the floor of the well in sequence, your bucket last.
- **Tabs:** the pressed tab pushes 6px into the felt and the other lifts; rows cross-fade in place over 120ms with no reorder animation.
- **Switch:** the knob slides 22px in 140ms and keeps its bottom face the whole way.
- **Box opened:** button presses flat, the status line is replaced in place by the rarity block, the accessory drops onto the counter with one 60ms overshoot. No burst, no shake.
- **Share:** the comment well types itself once on mount (~28ms/character, cancelled on first tap); posting drops the block flat and the well fills with one line of confirmation, in place.
- **Wardrobe stepper:** arrow blocks press; the counter does a 120ms quarter-turn tip as the item swaps, so the accessory reads as physically re-seated. (The counter is the one thing allowed to rotate.)
- **`prefers-reduced-motion`:** keep the existing policy — the reveal becomes a cross-fade to the final state, the box result cross-fades in, presses become instant state changes.

## State

No new state. Every screen maps to state the app already holds: `answer`, `guess`, `revealSlide` (0–2), `menuPage`, wardrobe `layer` selections and gift-box result, leaderboard `tab` (`week` | `all-time`), the show-my-counter setting, and the ask-form fields. The only additions are presentational: which block is currently pressed, and whether the share field has been touched (to cancel the typing animation).

## Tokens

```css
:root {
  /* felt */
  --felt: #2E9E6B;
  --well: rgba(8, 42, 25, 0.30);
  --well-pill: rgba(8, 42, 25, 0.32);
  --well-button: rgba(8, 42, 25, 0.28);
  --well-inset: inset 0 3px 5px rgba(8, 42, 25, 0.5);
  --well-inset-sm: inset 0 2px 3px rgba(8, 42, 25, 0.5);

  /* blocks */
  --cream: #FFF6E7;   --cream-face: #CBB795;
  --yellow: #FFC93C;  --yellow-face: #C48D12;
  --orange: #FF7A2F;  --orange-face: #BF5215;
  --violet: #8b5cf6;  --violet-face: #6D3EE0;

  /* ink */
  --ink: #22301F;                        /* on cream and yellow */
  --ink-on-felt: #FFF6E7;
  --ink-soft-felt: rgba(255, 246, 231, 0.6);
  --ink-soft-cream: rgba(34, 48, 31, 0.5);

  /* counters */
  --counter: #FFF1DA;
  --counter-mine: #FF7A2F;
  --counter-eye: #3A2A18;
  --counter-lift: inset 0 -2px 0 rgba(0,0,0,.16), 0 4px 7px rgba(18,32,24,.32);

  /* rarity — wardrobe only */
  --rarity-common: #8b93a1;
  --rarity-uncommon: #0f9bbd;
  --rarity-rare: #8b5cf6;

  /* block shadows */
  --block-sm: 0 5px 0 var(--face), 0 10px 13px rgba(10,40,25,.20);
  --block-md: 0 6px 0 var(--face), 0 12px 16px rgba(10,40,25,.24);
  --block-lg: 0 8px 0 var(--face), 0 16px 20px rgba(10,40,25,.24);

  /* radii */
  --r-well: 8px; --r-block: 10px; --r-hero: 12px; --r-pill: 7px;

  /* type */
  --font-display: 'Lilita One', system-ui, sans-serif;   /* always uppercase */
  --font-body: 'Space Grotesk', system-ui, sans-serif;
}
```

Spacing: the existing `--s1 … --s4` scale still works; the reference uses 7 / 10–14 / 16–20 / 22px gaps, which map onto it closely enough that you should not need a new scale.

Colours that leave the app entirely: `#e7e9f5`, `#15181d` ink borders, `#2b6be4`, `#00a676`, `#ff4d6d`, `#ffc53d` (replaced by `--yellow`), and every `3px 3px 0` offset shadow.

## Assets

No images. Two Google Fonts to add — **Lilita One** (400) and **Space Grotesk** (400, 500, 700); self-host them the way the four current families are self-hosted in `src/client/fonts` rather than hotlinking, then delete `gabarito-latin.woff2`, `instrumentsans-latin.woff2`, `dmmono-400-latin.woff2` and `dmmono-500-latin.woff2` once nothing references them.

## Files in this bundle

| File | What it is |
|---|---|
| `Outlier - Redesign Drafts.dc.html` | The design reference. **Turns 5 (`#5a`) and 4 (`#4a`), at the top, are canonical.** Everything below them is rejected exploration. |
| `Outlier - Current UI.dc.html` | Recreation of today's shipping UI, for comparison. |
| `support.js` | Runtime needed to open the two HTML files in a browser. Not a deliverable. |
| `screenshots/` | One PNG per frame at 2×, named by screen: `4a-01-question.png` … `5a-11-wardrobe-opened.png`, plus the three desktop frames (`*-desktop.png`). Use them to check your build against; read exact values off the HTML, not off the pixels. |

## Suggested order of work

1. Rewrite the token block and the three surface primitives in `styles.css` (`.block`, its four colours and three thicknesses; `.well`; the felt page). Delete `.card`, the 2px ink borders, and the offset-shadow idiom.
2. Convert the shell: felt page, header, well-pills. Every screen improves at once.
3. Restyle the counters in `DotCrowd.tsx` (paint only — leave layout and jitter).
4. Screens in play order: question, guess, reveal ×3, then the menu pages.
5. Motion last, as a pass over the finished screens — press behaviour first, then the reveal, then the small ones.
