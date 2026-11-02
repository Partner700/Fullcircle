# Release 216: Supabase migration

This release keeps the existing Full Circle features and switches the browser connection and public push key to project `ovusyeqbmtvfcrlflrbf`. It also advances the service-worker and recovery markers to 216, fixes the Arena browser timer type, and aligns the matchup test with the existing `The Scribe` display name.

## Publication gate

Do not merge or publish until the source database `nffqohxdelaglrmuzjwb` can be checked. The connected Supabase account currently has access only to the destination. The destination snapshot does not establish that the source has stopped receiving writes.

Before publication:

1. Compare current source data with the verified backup and destination, including updates as well as row counts. Reconcile any changes; retain private data outside this repository.
2. Stop the three reviewed Full Circle source jobs, allow in-flight work to finish, and copy the final alarm/notification history transactionally. Do not replay expired push requests.
3. Verify target Auth, storage references, payment callback configuration, Realtime, and push delivery settings. Confirm a target login and email delivery using an existing account.
4. Publish source plus this exact built `dist`, retaining prior release assets for cached phones. Verify the public HTML, manifest, worker, and active bundle all resolve to Release 216 and the target backend.
5. Activate the three preserved target jobs only after the public release verifies. Confirm the source jobs remain stopped and check the authenticated reading, quiz, Arena, photo, and payment flows.

The GitHub Pages mirror and Hostinger are separate publications. Do not describe a source push as a verified hosting update. Vercel deployment is a separate hosting change and should be configured and verified explicitly if selected.

## Recovery

If stopped before publication, preserve the current source frontend. If source jobs have been stopped, review whether to resume them before leaving the migration paused. If a frontend rollback is required after publication, reconcile any target writes first; never point users back to a stale database without reviewing that data.
