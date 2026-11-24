# Arena Turns and Relics (Release 210)

Journey rolls of six give another turn after the answer and all landing effects resolve, even after an incorrect answer or a timeout. A trial keeps the bonus pending. Prison cancels it; finishing the match ends it. Trials answers still earn no points.

Backward movement costs one point per actual square moved, including return-to-start, collective moves, delayed moves and the player sent backward by a swap. A forward lap wrap never deducts points. Points can be negative; the real correct-answer count is kept separately. The two-lap finish rule is unchanged.

Both Journey and Ludo accept owned Market question relics: Hint, Eliminate, Freeze Timer (+60 seconds), Skip (no point), Reveal Reference, Crystal Ball of Endor (secures the current answer), and Talking Donkey (stops one wrong answer before the deadline). Each type can be used once per open question. Account/streak recovery relics and the whole-quiz Sword of Goliath keep their existing non-Arena uses. Ludo's found-in-match relics are unchanged.

The backend validates player identity, turn, deadline, inventory and version. A single database transaction commits state, inventory, usage log and command deduplication. Relic effects never trust a client answer key. Public witnesses cannot spend relics or submit commands.

This release has one additive migration. It never runs Release 209's question-bank reset. Install the migration before deploying both `biblical-journey` and `road-home-game` functions, then publish the matching frontend.

Checks:

```sh
npm run check
npm run test:journey
node --experimental-strip-types scripts/arena-turn-relics.test.ts
PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/arena-relics-postgres.test.mjs
```

Release preparation: the full check passed (0 errors, 355 existing lint warnings), Journey tests and the PostgreSQL transaction tests passed. The production build passed. Browser checks were extended for relic use and witness restrictions, but could not be executed in this session: no browser was connected and the sandbox did not permit a local server to listen. Live installation and phone verification remain deployment steps.
