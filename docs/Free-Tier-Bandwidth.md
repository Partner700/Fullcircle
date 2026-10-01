# Free-tier bandwidth changes (v157)

This release reduces future transfers without a paid service, database migration,
account transfer, or deletion of user content. It does not remove Supabase's
existing `exceed_cached_egress_quota` / `exceed_egress_quota` restrictions.

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

## Limits and follow-up

These limits apply to new uploads, not old photos already stored. This release
does not download or re-upload existing user media while the project is restricted.
It does not guarantee that a growing community will remain within the free quota.

After access returns, compare Storage, Database, Realtime and Auth egress in the
Supabase Usage dashboard over comparable days. Identify large, frequently served
existing files before optimizing them. Public decorative artwork can be moved to
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
overlap prevention. Run alongside typecheck, the main suite, and mobile tests.
Live bandwidth savings must be measured after service is restored.
