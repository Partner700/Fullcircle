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
