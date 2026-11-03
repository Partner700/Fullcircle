# Release 222: Puzzle Trivia rewards and The Prelude

Puzzle Trivia now uses authenticated server commands to validate words, enforce deadlines, consume owned relics and award account FIGS. Unassisted words earn 1/3/5 FIGS on Easy/Medium/Hard, once per word and difficulty/level. A first clear earns 500 Denarii; retries cannot duplicate rewards. Compatible relics are Hint, Eliminate, Freeze Timer (+60 seconds once per round), Skip, Crystal Ball of Endor and Reveal Reference. Scripture references are omitted from responses until Reveal Reference is consumed for that word, including after completion. Assisted words earn no FIGS. Legacy device-only rounds do not grant retroactive account rewards.

The Prelude supports Easy MCQ and Hard select-all questions, 2–10 human players or a human against the Machine. Its private shuffled deck has 100 numbered cards (20 Scripture numbers across five tent symbols) and four jokers. Faces display the tent symbol and repeated corner numbers; backs use the supplied dove artwork. All closed cards are selectable around the center card. A number or symbol match opens a server-graded question. A correct answer or a joker captures all open cards. A miss or wrong answer stays as the next target. The next player then takes a turn. Each turn has 45 seconds to flip and each question has 60 seconds to answer. The round ends when there are no closed cards. The most collected cards wins; ties use correct answers, then earliest capture. The server controls the machine and awards the human winner 1,000 Denarii once.

Prelude is offered in Daily Games, Arena, and the instructor's tournament game selector. Tournament matches use the existing 2–4-player fixtures and bracket advancement, with one 104-card Prelude round rather than legacy multiple legs. The round winner receives 1,000 Denarii without the legacy participation and 5,000-Denarii match prizes. Existing tournament champion bonuses remain in effect. Classic, Ludo and Journey tournament behavior is retained.

## Validation

- Production build, TypeScript, full existing automated suite and ESLint passed (existing warnings, no errors).
- PGlite integration: hidden answers/references/deck, valid/invalid/repeated words, FIGS, 500-Denarii idempotency, relic inventory and reference scope, expired rounds, account isolation, anonymous denial, full 104-card deck, matching/capture/miss/joker behavior, stale turn protection, hard exact answer sets, ten-player limit, server machine turns, and 1,000-Denarii idempotency.
- Tournament integration: real existing registration/series/settlement triggers, Prelude category, one-round format, exact round prize, advancement, lifetime FIGS inclusion, Prelude isolation from legacy inactivity forfeits, and the existing Journey/Classic/Ludo/optional-date regression suite.
- Browser interaction and phone touch verification remain pending; the available browser could not reach the local preview. No signed-in production gameplay was simulated.

Integration runners use the existing repository convention of a PGlite module supplied through `PGLITE_MODULE`:

```
node scripts/scripture-games.integration.mjs
node scripts/prelude-tournament.integration.mjs
```

## Production status

The user explicitly authorized the Release 222 production migration and publication on 3 November 2026. The migration was applied to the New TNS Full Circle Supabase project. Live transaction tests verified Puzzle Trivia word validation, FIGS totals, the 500-Denarii first-clear reward, duplicate protection, reference locks, anonymous access denial, and Prelude machine-room/deck startup. Test data and rewards were rolled back. The unrelated pending Redemption Coin migration is excluded.
