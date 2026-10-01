# Free-tier bandwidth changes (v158)

This release reduces future transfers without a paid service, account transfer,
or deletion of user content. It includes one additive database function for
compact quote summaries. It does not remove Supabase's existing
`exceed_cached_egress_quota` / `exceed_egress_quota` restrictions.

## Implemented

- New avatar and FCX guest photos: at most 640 pixels on the longest side and
  160 KiB. The crop editor still works normally.
- New artwork and tent images: at most 1600 pixels and 512 KiB. Challenge evidence
  keeps a 2200-pixel, 768 KiB allowance for readability. PDF handling is unchanged.
- Existing small images are not re-encoded. WebP encoding and browsers that fall
  back to PNG both respect the output byte limit. Unsupported photos retain the
  existing helpful error and do not silently upload the large original.
- FCX guest and tent photos now use the same one-year browser cache policy as
  other uploads. Their versioned filenames prevent stale images after edits.
- Artwork settings are reused in memory for 60 seconds. Concurrent reads share
  one request. Edits, account changes, and sign-out invalidate this cache; failed
  reads are not cached. No private API responses are put in persistent caches.
- Recent Awards requests the current week's awards from the server rather than
  repeatedly downloading the entire award history. The full awards view remains
  available. Failed refreshes retain the last successfully loaded content.
- Recent Awards, quiz responders, and quiz rankings pause polling while hidden
  or offline, refresh on return, and avoid overlapping requests. Quiz responders
  retain realtime updates; their fallback polling interval is now 60 seconds
  rather than 15 seconds.
- Existing lazy-loaded artwork and browser image caching are retained. Old app
  bundles remain available so an already-open app does not lose its screens.
- Direct and tent conversations now open with the latest 20 messages. Older
  messages load in 20-message pages, while new arrivals are fetched from the
  last cursor rather than downloading the full conversation again. Equal-time
  messages use an ID tiebreaker, unread rows are marked in one update, edits
  appear immediately, and opening an older treasure-bearing message still
  reveals its challenge.
- The reading archive now downloads 20 small index rows at a time. Full Scripture,
  questions, meditation text and conversations load only after a day is opened.
  The archive still supports every retained reading and shows whether that day
  has a saved meditation.
- Quote reactions and comment totals are aggregated in Postgres for only the
  requested user/date pairs. Counts are not subject to the REST 1,000-row cap,
  the current person's reaction is retained, and each reacting profile is sent
  once even when it appears on several quotes.
- Meditation History gets visible streaks in one RPC instead of one request per
  participant.
- Dashboard, reading and sentry social subscriptions now filter INSERT/UPDATE
  traffic to visible dates, insights and tent members. DELETE remains unfiltered
  because Postgres Changes cannot filter deleted rows; this preserves immediate
  unlike/removal behavior. Daily-game player fallback refreshes pause when the
  app is hidden/offline and run every 60 seconds instead of every 20 seconds.
- Challenge boards no longer subscribe every viewer to seven camp-wide tables.
  They refresh once per minute only while visible and online, with immediate
  catch-up when the tab becomes visible or the connection returns.
- Development builds expose `window.fullCircleEgress.report()` for route-level
  request counts, failures, decoded response bytes and elapsed time. It never
  records URLs, IDs, filters, headers, request bodies, response contents or auth
  payload sizes. Production builds contain no diagnostics instance.
- `node scripts/audit-egress.cjs` inventories selects, realtime subscriptions and
  intervals without pretending every wildcard or timer is automatically wrong.

## Measured examples

These are query-level measurements from the October 1 database, not a promise
about total monthly usage:

- Reading archive: the old 66-row narrative payload was about 1,916,394 bytes.
  The first 21-row archive index is about 3,072 bytes, before its small
  meditation-status lookup: more than 99% less for opening the archive.
- Quote summaries: a 100-quote sample fell from about 124,467 bytes to 49,782
  bytes while preserving all 625 reactions: about 60% less for that response.
- Storage audit: 196 objects occupy about 106.9 MB. The largest existing image is
  about 6.5 MB. New upload limits prevent recurrence, but old images were not
  automatically copied or replaced while the service is restricted.
- Existing database statistics showed 23,817 quote-reaction list calls and
  17,190 quote-comment list calls, confirming this was a high-value aggregation.

## Limits and follow-up

These limits apply to new uploads, not old photos already stored. This release
does not download or re-upload existing user media while the project is restricted.
It does not guarantee that a growing community will remain within the free quota.

After access returns, compare Storage, Database, Realtime and Auth egress in the
Supabase Usage dashboard over comparable days. Identify large, frequently served
existing files before optimizing them. Compressing existing objects needs a
separate, backed-up migration that updates references only after every replacement
upload succeeds. Public decorative artwork can be moved to
the static app host after reviewing which assets are appropriate for publication;
user photos, evidence, and private content must not be copied to a public repo.

Supabase documents that reducing future requests does not undo bandwidth already
used. For this no-cost plan, the restriction must clear at the usage-cycle reset
or through assistance from Supabase support; a support exception is not guaranteed.

Sources:
- https://supabase.com/docs/guides/platform/manage-your-usage/egress
- https://supabase.com/docs/guides/storage/production/scaling

## Verification

`npm run test:bandwidth` covers byte limits, encoder fallback, small-file reuse,
cache expiration/invalidation/isolation, hidden/offline polling, resume, and
overlap prevention, private diagnostics, message cursors and scoped realtime.
`scripts/egress-summaries-db.test.cjs` verifies exact quote pairs, counts above
1,000, actor reuse, RLS, authentication and input limits in isolated Postgres.
`scripts/message-pages-browser.test.cjs` verifies paging, catch-up, draft retention,
edits, failures and conversation switching at phone and desktop widths. Run these
alongside typecheck, the main suite and mobile tests. Live total savings must be
measured after service is restored.
