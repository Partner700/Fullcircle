# Monthly Award Nominees

The instructor's Awards Hub includes **Monthly Nominees & Potential Winners**.
Select a calendar month, choose a winner or any other nominee, and give the award
immediately or add it to the existing scheduled release. Recommendations do not
grant awards automatically.

## Categories

- Vallum: cadet monthly activity, with Marks as the tie-breaker.
- Monthly Scribe: total monthly figs across completed games, quizzes, Arena and Story Mode.
- Monthly Valley Champion: completed Arena victories that month.
- Messenger Award (Nuncio): insight likes, public meditations and external shares that month.
- Centurion: sentry monthly activity, with Marks as the tie-breaker.
- Bethel Stone: combined activity of each tent's current cadets, with combined Marks as the tie-breaker.
- Muralis: registered cadets from the most recent completed FCX. The instructor chooses the actual event winner; registration order is not a performance ranking.

Activity retains the existing monthly watch formula: three points per punctual
attendance/meditation action, five per insight, two per comment and one per
reaction. Equal ranked measurements can show multiple potential winners.
The watch uses Africa/Douala calendar boundaries and current active roles.

## Reliability and Access

`get_monthly_award_nominees(date)` is an instructor-only, read-only RPC. It does
not call the live streak reconciliation path. Each category includes names,
avatars, measurements, leader status and recipient IDs. All eligible nominees
can be expanded beyond the initial four.

Failed requests display a retry action instead of claiming no activity. Failed
refreshes preserve successfully loaded results for the same month. Switching
months hides the old month immediately. Requests do not overlap, and background
tabs do not poll.

## Verification

- `scripts/monthly-award-nominees-db.test.cjs`: all seven categories, grants,
  authorization, current roles, local month boundaries, ties, fig sources,
  tent totals and manual FCX selection. Uses PGlite via `PGLITE_MODULE_PATH`.
- Browser checks at phone and desktop widths: category names, nominee expansion,
  selection, failed requests, retry and no horizontal overflow.
- Live authenticated-role query verified September 2026 nominations after the
  migration was applied. No awards were granted by verification.
