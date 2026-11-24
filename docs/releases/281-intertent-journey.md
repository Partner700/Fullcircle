# Release 281 — David Journey Inter-Tent Championship

## Scope

The separate Inter-Tent Championship panel is available in the Arena. The standard tournament format and rules remain unchanged. The agreed lineups are preselected when an instructor opens the draft. PH and Linbaks are not among the preselected players. Megan and every other entrant must reach 500 lifetime Figs and 3 Rhudes before activation. An instructor can replace a provisional player or correct dates while the event is a draft.

- Opening: Sunday 22 November 2026, 7 PM Cameroon time.
- Group fixtures: Tuesdays and Thursdays, 6 PM and 6:30 PM, from 24 November through 17 December. Fixtures are explicit single games, with the return leg at the same weekday and time the following week. The second game waits until the first has completed.
- Four players represent three tent sides in each group. The same-tent pair receives shared 3/1/0 tournament points. The first finishing player determines the winning tent side. The other sides are ordered by average game score and correct answers. A teammate is excluded from harmful position swaps and transferred penalties.
- Each resident's group standing uses average points per completed match, because residents can enter multiple groups. Ties are ordered by average correct answers, then average score; a stable entrant ordering is used for otherwise identical records. The highest ranked resident from each of the three tents qualifies.
- Semifinal home and away: Tuesday 22 and Thursday 24 December, 6 PM. The top two after both legs advance to the grand final on Tuesday 29 December, 6 PM.
- Appointments that need a replay can be rescheduled by an instructor; activated results cannot be overwritten.

## Installation order after approval

1. Confirm the published base remains Release 280 and the release source is based on the latest GitHub main. Do not force-push.
2. Apply `scripts/install-intertent-championship.sql` once to the correct Full Circle Supabase project. It adds private RLS-protected event records, permission-checked RPCs, and independent scheduled fixture settlement. It also excludes championship matches from the older automatic multi-round series trigger, so an explicit home/away fixture does not spawn unscheduled games.
3. Deploy the `biblical-journey` edge function with its changed shared Journey runtime. Existing games retain their original behavior unless server-side tent sides are assigned.
4. Publish the identical verified Release 281 build on GitHub Pages and PartnerTAI, preserving the previous asset references. Verify both URLs and the release manifest, entry bundle, stylesheet and service worker.
5. Sign in via the actual instructor account for Camp 1. Create the preselected David tournament as a draft; verify the 19 fixture records (16 group fixtures, 2 semifinal legs, 1 final). Do not activate while any entrant has not qualified. On activation only, the selected players receive match notifications.

## Local release checks

`npm run test:intertent` covers fixture dates, side labels, teammate exchange exclusion, eligibility, camp isolation, serial match starts, draft editing, shared side points, avoidance of normal automatic series, and complete group-to-semifinal-to-final progression using a disposable PostgreSQL-compatible test database.

Also run `npm run typecheck`, `npm run test:journey`, `npm run test:mobile`, and `npm run build`. The unrelated Release 280 daily-games-hub test has a pre-existing stale expectation for shared quiz access; report it separately rather than changing unrelated access behavior in this release.
