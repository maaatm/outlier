# Subreddit description copy

The sidebar text. It carries what the app's **How to play** and **The four outcomes**
rooms used to, now that both are cut — somebody arriving cold reads the game here, and the
app's menu keeps only a three-sentence tagline.

Every number below is read out of `src/shared/`. The table at the end says which constant
each one came from, so this file can be re-checked when one of them moves.

---

## Short version — for the sidebar description field

> One question a day about ordinary behavior. Answer it, then guess what percentage of
> people answered the same way. You find out two things at once: how unusual you are, and
> how well you read everyone else.

---

## Long version — for the sidebar / wiki

### What this is

One question a day about ordinary behavior. Two taps, no typing, under fifteen seconds.

1. Tap the answer that is true for you. There are always exactly two.
2. Guess how many people out of 100 answered the same way.
3. Lock it in. The crowd splits, and you find out two things at once.

Nobody sees the split before they answer. That is the whole game — a guess made against a
number you can already see is not a guess.

### The two axes

**Rarity.** Whether you took the minority side. Your side is the minority below 35% of the
vote.

**Accuracy.** How far your guess sat from the real split. Within 10 points counts as
reading the room.

They are independent, and neither one is the good outcome. Being unusual is not a score.
Knowing you are unusual is.

### The four outcomes

|  | Guessed well | Guessed badly |
|---|---|---|
| **Majority answer** | **Baseline** — you went with the room and you knew it. | **Impostor syndrome** — you went with the room and thought you were alone. |
| **Minority answer** | **Self-aware outlier** — you went against the room and saw it coming. | **Living in a bubble** — you went against the room and had no idea. |

### Points

Every vote pays 10 for turning up, plus one accuracy band on how close the guess landed:

| Band | Off by | Bonus |
|---|---|---|
| Bullseye | 2 or less | +50 |
| Sharp | 5 or less | +30 |
| Close | 10 or less | +15 |
| Warm | 20 or less | +5 |
| Cold | more | 0 |

Close shares its ceiling with the accuracy threshold on purpose: the point at which the
game says you read the room is the point at which it stops paying much for it.

### The streak

Consecutive days on which you answered at least one question. Days turn over at midnight
UTC, the same moment the Daily posts.

- **Any question counts** — the Daily, an open question somebody submitted, or one played
  out of the archive. The day recorded is the day you voted, not the day the question ran.
- **One a day is all it needs.** A second question the same day pays points but does not
  move the streak.
- **Miss a day and it resets to zero.** Your best keeps the number it reached and is never
  reduced.

### Asking your own question

**Ask a question** in the app's menu, or **Submit a question** in the subreddit menu.
Either way it becomes its own playable post immediately, counts toward streaks and points
like any other, and enters the queue to be promoted to a Daily. Three a day per person.

The post title is optional. Leave it and the question is the title.

Questions are about ordinary behavior — things a person can answer about themselves
without looking anything up. Not opinions, not politics, not trivia.

### Nothing closes

Yesterday's Daily stays open. Old questions still pay points and still count toward a
streak, so the archive stays playable. A split posted the next morning says where it
*stands*, not where it ended.

---

## Where the numbers came from

| In the copy | Constant | File |
|---|---|---|
| minority below 35% | `MINORITY_THRESHOLD` | `src/shared/config.ts` |
| within 10 points reads the room | `HIT_THRESHOLD` | `src/shared/config.ts` |
| out of 100 | `CROWD_SIZE` | `src/shared/config.ts` |
| 10 for turning up | `POINTS_BASE` | `src/shared/config.ts` |
| the five bands and their bonuses | `BANDS` | `src/shared/points.ts` |
| the four outcome names and lines | `BADGES` | `src/shared/badges.ts` |
| three questions a day | `SUBMISSIONS_PER_DAY` | `src/shared/config.ts` |
| streak rules, UTC day boundary | `advance()`, `toDayKey()` | `src/server/core/users.ts`, `src/shared/day.ts` |

Two numbers are deliberately left out: `PROMOTION_THRESHOLD` (10 upvotes to reach the
Daily) and `LEADERBOARD_MIN_VOTES` (25 votes to rank). Neither changes how anyone plays,
and the sidebar is not a spec.
