# Writing questions

A moderator's guide to the only thing that decides whether this game is any good.

## The one rule

**A question works when people cannot accurately predict the split.**

That is the whole test. Not "is it interesting", not "is it funny" — can a reasonable
person guess, within ten points, what percentage of the subreddit will say yes? If they
can, the second half of the game does nothing and the question is dead weight.

The best questions produce a genuine 30/70 through 50/50 spread *and* leave players
confident about the wrong number.

## Good

> Do you eat the pizza crust?
>
> Have you ever gone a full day without speaking to anyone?
>
> Do you still set a physical alarm clock?
>
> Do you read the instructions before assembling furniture?

What these have in common:

- **An ordinary habit.** Something a person does or does not do, without deliberating.
- **No socially correct answer.** Neither side makes you look better than the other.
- **Private enough that nobody has counted.** You know what *you* do. You have no idea
  what anyone else does, because it has never come up.
- **Answerable in under a second.** No "it depends", no mental arithmetic.

That last point is what makes the fifteen-second interaction possible.

## Bad

> Do you brush your teeth?

No spread. Ninety-something percent say yes and everyone knows it.

> Do you like pizza?

Same problem, and it is a preference rather than a habit.

> Do you think people should recycle?

An opinion with an obvious right answer. Everyone performs agreement.

> Do you support [any political position]?

Never. Politics, medicine, and identity are all out — see below.

## Always reject

**Political, medical, or about identity.** Three reasons, all of them practical:

1. The tone is wrong. The game is dry and observational; these questions are not.
2. They invite brigading from outside the subreddit.
3. The answer stops being a habit and becomes a statement. Once a player is declaring
   something about themselves rather than reporting what they do, the minority badge
   reads as an accusation instead of an observation.

Also reject:

- **Anything with a correct answer.** Trivia is a different game.
- **Anything needing context the reader does not have.** Regional, seasonal, or
  subculture-specific questions split on who is reading, not on behaviour.
- **Compound questions.** "Do you make your bed and fold your laundry?" has four
  answers, and the form only offers two.
- **Anything phrased to lead.** "Do you *still* do X?" with a sneer produces a
  performed answer.

## Custom answer labels

Default to Yes / No. Reach for custom labels only when the question is genuinely a fork
rather than a yes-or-no:

> Do you park front-in or reverse into the space? — `Front-in` / `Reverse`
>
> Do you brush your teeth before or after breakfast? — `Before` / `After`

Labels cap at twelve characters. If a label needs more than that, the question is
probably asking two things.

## The feedback loop

The app tracks average guessing error per question and surfaces a leaderboard of the
most misjudged questions ever — available in the app on any reveal screen, and postable
as an event post from the mod menu (**Outlier: post the misjudged leaderboard**).

Read that leaderboard before you approve anything. It will teach you what works here
faster than this page will, and it is worth posting periodically: it shows the subreddit
what a good question looks like by example rather than by rule.

## Reviewing the queue

**Outlier: review the question queue** lists the top twenty pending community questions
by upvote, with approve and reject.

- **Approve** makes a question eligible for the Daily slot. It still needs
  `PROMOTION_THRESHOLD` upvotes (10 by default) before it can be promoted, and the
  highest-scoring eligible question wins the slot.
- **Reject** removes it from the queue. The open post stays up and stays playable — the
  question just will not become a Daily.

Nothing reaches the Daily slot without passing through this. That gate is deliberate:
the Daily is the flagship post and unmoderated content should never land in it.

When a community question is promoted, the submitter is credited by username in the
Daily post body automatically.
