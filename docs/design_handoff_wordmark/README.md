# Task — replace the menu title with the 8c wordmark

Scope: the `Outlier` title at the top of the menu root, plus the small wordmark in the app header. Nothing else on the menu changes — the **Today's question** block, the four row-blocks and the back button keep their current styling and order.

This folder is a follow-up to `design_handoff_blocks_ui/`, which covers the rest of the redesign. If that work is already in, this is a patch on top of it; if it is not, this can land first — it touches nothing else.

## Files here

- `README.md` — this prompt.
- `Wordmark 8c.dc.html` — the reference. Open it in a browser. It shows the 58px menu lockup, the 22px header lockup, the sub-18px fallback, and the whole menu root at 400×780. Every number below is measurable in it.
- `screenshots/` — 2× captures of the same frames.

Repo target: `components/Menu.tsx` (the `Root` view), and wherever the header wordmark is rendered today (see `## Screen map` in `github.md`).

## What it is

The wordmark is one orange counter followed by the letters `UTLIER`. The counter is the default game piece — plain disc, two eyes, moulded bottom face — tilted the way discs land on the table and overlapping the U slightly. It is deliberately *not* a letter: it reads as a piece dropped into the word.

Build it as a single component, `<Wordmark size={58} />`, used at two sizes. Do not inline it twice.

## Geometry

Everything scales off one number, the font size `S`:

- disc diameter — `0.79 × S`, rounded (58 → 46px, 22 → 17px)
- disc rotation — `-9deg`
- disc overlaps the U — `margin-right: -0.05 × S` (58 → -3px), `z-index: 2`
- extrusion depth — `0.12 × S` (58 → 7px), floor at 3px
- eyes — `18%` of the disc, square, `border-radius: 50%`, `top: 30%`, `left: 22%` / `right: 22%`, `background: #3A2A18`
- the letters and the disc are centred on each other: `display: flex; align-items: center` on the lockup, `line-height: .8` on the text so the text box collapses to roughly cap height. Do not use `align-items: baseline`.

## Exact styles at S = 58 (menu)

Lockup wrapper

```css
display: flex;
align-items: center;
```

Disc

```css
position: relative;
display: block;
width: 46px;
height: 46px;
border-radius: 50%;
background: #FF7A2F;
rotate: -9deg;
z-index: 2;
margin-right: -3px;
box-shadow: inset 0 -4px 0 rgba(0,0,0,.18), 0 7px 0 #BF5215, 0 13px 16px rgba(10,40,25,.32);
```

Eyes (two spans, absolutely positioned inside the disc)

```css
position: absolute;
top: 30%;
width: 18%;
height: 18%;
border-radius: 50%;
background: #3A2A18;
/* left eye: left: 22%   right eye: right: 22% */
```

Letters

```css
font-family: 'Lilita One', sans-serif;
font-size: 58px;
line-height: .8;
letter-spacing: .025em;
text-transform: uppercase;
color: #FFF6E7;
text-shadow: 0 7px 0 #B79E76, 0 13px 16px rgba(10,40,25,.3);
```

The text content is the literal string `utlier` with `text-transform: uppercase` — the disc supplies the O.

## Header variant, S = 22

Same component, `size={22}`: disc 17px, `margin-right: -1px`, `box-shadow: inset 0 -2px 0 rgba(0,0,0,.18), 0 3px 0 #BF5215, 0 5px 7px rgba(10,40,25,.3)`, letters `font-size: 22px`, `text-shadow: 0 3px 0 #B79E76, 0 5px 7px rgba(10,40,25,.3)`. This replaces the plain `Outlier` span in the header on every screen that shows the wordmark (question, guess, reveal, share, desktop). Screens whose header shows a Space Grotesk screen label instead (`MENU`, `WARDROBE`, `LEADERBOARD`, …) are unchanged.

Below 18px the eyes stop resolving — under that, fall back to the plain Lilita One `OUTLIER` with no disc.

## Placement on the menu

In the reference the wordmark **leaves the cream hero block** and sits on the felt:

1. header row (label `MENU`, streak and pts wells) — unchanged
2. `margin-top: 44px` → the wordmark lockup
3. `margin-top: 26px` → tagline `one question a day`, Space Grotesk 700, 9.5px, `letter-spacing: .24em`, uppercase, `rgba(255,246,231,.6)`
4. `margin-top: 14px` → the explainer paragraph on the felt, Space Grotesk 500 13px/1.55, `rgba(255,246,231,.82)`
5. `margin-top: 24px` → the orange **Today's question** block, exactly as it is now
6. the four cream row-blocks and the back button, unchanged

So the cream hero block that currently wraps the title and paragraph is deleted, not restyled. Keep the paragraph copy as it is in the shipping app.

## Details that matter

- The disc's `rotate` must be on the disc, not the wrapper — the letters stay level.
- The eyes are children of the disc, so they rotate with it. That is intended.
- The orange is the same `#FF7A2F` / `#BF5215` pair as the primary button, so the wordmark and the CTA agree.
- `inset 0 -4px 0 rgba(0,0,0,.18)` is the counter's own moulded edge and is what makes it read as a game piece rather than a dot. Keep it even though the disc also has a bottom face.
- Accessibility: the lockup gets `aria-label="Outlier"` and `role="img"`; the eye spans are `aria-hidden`. The letters must not be announced as "utlier".
- No SVG, no image asset. Two spans and a text node.

## Done when

- Menu root shows the 8c lockup on felt, no cream hero block, and matches the reference frame side by side at 400×780.
- Every header that previously showed the plain wordmark now shows the 22px lockup, vertically centred against the streak/pts wells.
- The component takes only `size`, and nothing else in the app hardcodes 46 or 17.
