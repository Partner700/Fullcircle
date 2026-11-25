# Full Circle v3 — production reliability and recovery

Project: `ovusyeqbmtvfcrlflrbf` (Supabase eu-west-3), organization **Full Circle V3**.
Hosting: GitHub Pages `TNSorganization/Full-Circle` and PartnerTAI mirror.
Last confirmed incident: 24 November 2026. Support ticket `SU-567772`.

## Triage order
1. Verify the GitHub Pages / PartnerTAI frontend is serving assets. Do **not** confuse a 200 on the static website with a working sign-in.
2. Check Supabase Auth `/auth/v1/token` error rate (500/504), Data API 502/503/504, connection pooler login timeouts, and whether simple Postgres SQL works. Check UTC times.
3. Inspect `pg_stat_activity`, slow/expensive functions in `pg_stat_statements`, and recent `cron.job_run_details` failures. A project labeled `ACTIVE_HEALTHY` can still return 500/504.
4. Compare recent deploys and client request rates. During an outage, avoid repeated client retries and halt nonessential requests rather than resetting user accounts.
5. Escalate to Supabase with project ID, UTC timestamps and redacted request IDs. Do not send passwords, refresh tokens, publishable account secrets or private user details.

## Keep gameplay safe
- Do not treat a heartbeat timeout or failed room fetch as proof of forfeiture; server-side `forfeited_at` is authoritative.
- Keep the saved Arena room identifier; reconnect with an authenticated session, refresh room state and rejoin the existing room.
- Debits and rewards must be idempotent and traceable in the Denarii ledger. Never debit again just because a mobile app retries a join.
- When confirmed server failure makes timely entry impossible, suspend or reverse penalties **for affected fixtures**, with an auditable ledger adjustment.
- Make any mass penalty changes only after an explicit incident review; do not blindly clear player records.

## Workload and capacity
- Inspect connection counts, CPU, RAM, database disk I/O, and WAL/Realtime throughput at peak Arena attendance.
- `pg_stat_statements` is cumulative, not a proof of current overload. Compare deltas or reset statistics in a controlled maintenance window.
- Prioritize hot RPCs such as `get_user_live_stats`, `get_arena_matchups`, `get_my_streak_protection_state` and frequent Realtime subscribers.
- Periodic award publishing and inter-tent penalty settlement run every 5 minutes; review failed jobs before tightening frequency.
- Add indexes against actual filters and query plans. Do not automatically execute every Supabase performance advisor suggestion.
- Before large events, load-test on a separate staging project; never stress-test production while participants are playing.

## Backups and restores — required remaining configuration
**The Supabase organization was confirmed Free on 25 November 2026.** According to Supabase's current [backup documentation](https://supabase.com/docs/guides/platform/backups), Free projects should export data regularly; automatic daily backups are on Pro and higher tiers.

1. Configure an **encrypted, private, off-platform** export destination. Never store raw player records, email addresses, password hashes or ledger data in a public GitHub repository or a publicly downloadable CI artifact.
2. Use the supported Supabase CLI `db dump` workflow from a trusted machine/private runner with secrets stored in a secret manager. Store regular logical backups with retention and versioning; include required Auth-related tables according to the supported export method.
3. Separately back up Storage API objects if needed: database backups do not contain the binary files.
4. Test a restore into a **separate staging project** and verify auth/profile permissions, Arena fixtures, game scores, Denarii balances and payment reconciliation before declaring disaster recovery ready.
5. Review managed backup / Point-in-Time Recovery options and project compute capacity before authorizing a paid-plan change. Do not silently upgrade or pause/restart the live database.

## Monitoring
- GitHub workflow `full-circle-health.yml` checks public Auth health and REST gateway every five minutes and creates an issue after consecutive failed runs; **this is not a real password-login test**.
- ChatGPT's Full Circle outage watch checks recent Supabase logs and the support email every hour.
- Alert on sustained authentication failures, gateway 5xx and database SQL connection timeouts.
- Record baseline latency, recovery times, load-test results and each incident's corrective action.

## Rollback
- Deploy the last verified application release using the mirror workflow; confirm the immutable source SHA in the `gh-pages` build marker.
- For SQL changes, use a reviewed forward migration or targeted rollback after checking dependent functions and constraints. Never wipe production data to repair login.

## 25 November 2026 pre-test reliability fixes
- Inter-Tent leaderboard/championship polling now staggers viewers by a stable per-user offset and backs off on repeated API failures (15–120 seconds). The last verified scoreboard remains visible instead of hammering a failing endpoint.
- `public.heartbeat_arena_participant` now expires/settles inactive players only within the heartbeat's own room. The original three-minute standard-game rule and Inter-Tent/Prelude exemptions are unchanged. Avoid global expiration scans from individual player heartbeats.
- `public.watch_arena_room` no longer locks `arena_rooms` for spectator entry; a reserved player is handed to `join_instructor_arena_match`, where player admission remains serialized. Witnesses still need an authenticated account and an open match.
- `private.process_intertent_late_penalties` skips already-settled fixtures before acquiring locks. The 15-minute grace, gameplay-progress guard, one-charge ledger key and server-side cancellation protections remain in effect.
- `private.refund_cancelled_intertent_late_penalties` automatically refunds a charged player when an Inter-Tent match transitions to canceled; credits have a unique key. Three previous unrefunded canceled-match penalties (15,000D total) were restored with auditable entries. Do not overwrite the source debits.
- No Supabase plan upgrade, new project, bulk data migration or real-person load test is authorized by this preparatory release. Supabase support incident ticket: SU-567772; RCA remains pending.

## Load-test acceptance checklist (staging only)
1. Confirm a **separate** staging Supabase project and dedicated staging accounts; never send traffic spikes to project `ovusyeqbmtvfcrlflrbf`. Copy only sanitized fixture data, not private user records or payment credentials.
2. Measure real password sign-ins (not just `/auth/v1/health`) at 10, 25 and then 50 concurrent users. Verify success/failure rate, p95 latency, server 5xx, CPU/RAM, database pool and storage/network errors. Stop the test if failures persist; do not escalate blindly.
3. Create staging Journey games with one, then four eligible players; join viewers in groups of 10, 25 and 50 while moves occur. Verify order of turns, exactly-once commands, score integrity, witness access and no room-lock backlog.
4. Interrupt and restore a player's network after a recorded move. Verify the player returns to the same match, no duplicate payment, and no incorrect inactive forfeiture for Inter-Tent players.
5. Verify on staging that joining at 14 minutes incurs no late debit; joining after 15 minutes remains possible with exactly one 5,000D deduction; canceling a fixture reverses that deduction exactly once. Use staging-only ledger records.
6. Confirm the deployment SHA and all targeted tests. A static-host deployment success is **not** a real login test. Obtain Supabase's root-cause report before deciding whether Free compute is sufficient for peak sessions.

The existing `scripts/full-circle-staging-load-test.mjs` probes Auth health/REST endpoints only; it does **not** substitute for authenticated or live-game concurrency testing. Keep its production-URL refusal enabled.
