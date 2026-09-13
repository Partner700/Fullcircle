# Profiles, Alarms, Uploads, and Birthdays

## Included
- Profile uses the app's streak Flame and Figs BadgeCheck, with Marks and approved Challenges in the six-stat grid below the identity header.
- Instructor artwork slot: Member Profile. Its image adjustments and light/dark veils use the existing panel artwork system.
- Cadet evidence uploads now use the user's permitted storage folder. Instructor artwork and avatar/evidence uploads get phone-image resizing, MIME inference, actual canvas output MIME, and one retry after refreshing an expired session.
- Personal alarms in Settings > Device Notifications > My Alarms: name, time, timezone, repeat days or a one-time date, enable/disable, edit, delete. Questions still dismiss alarms.
- Server-side alarm dispatch and retries, per-device delivery receipts, expiring push TTL, existing subscription resync, and local expiry even during connection loss.
- Birthday reactions support unlike. Birthday wishes support replies and author-only editing, small avatars, relative timestamps, and celebrant notifications. The slide pauses while wishes are open; visible threads refresh every 10 seconds. Conversations are keyed by celebration and date, not merged across birthdays or years.
- No streak, economy, reward, or quiz rules changed.

## Alarm Boundaries
The standard Mon-Fri alarms remain 05:59 for established users, and 12:00, 18:00, 20:30 only without a submitted meditation. Missed windows expire after ten minutes, without catch-up. Personal schedules are explicitly opt-in and may run on any chosen day, including for newcomers.

A closed PWA receives OS-managed Web Push notifications, not a forced continuous siren. Permission, OS notification settings, connectivity, and battery restrictions affect delivery. On iPhone/iPad, install to the Home Screen and enable notifications inside that installed app. In-app volume does not override the phone's system volume. Native alarm integration would be a separate project.

HEIC conversion depends on the browser's native decoder. Unsupported devices receive a clear request for a JPEG copy; arbitrary HEIC support is not claimed.

## Deployment
Run the updated local deployment command:

```bash
bash /Users/bameelhakol/Documents/Codex/2026-07-23/los/deploy-profile-experience-release.sh
```

The script validates the pinned release, uses Supabase browser login, previews migrations, checks that existing VAPID key secrets are configured, applies migrations, deploys send-push-notification, and then publishes the web bundle. It stops on failures rather than publishing a frontend without its backend.

Required migrations:
- 20260913100000_profile_challenge_totals.sql
- 20260913103000_personal_scripture_alarms.sql
- 20260913110000_alarm_push_retries.sql
- 20260913113000_birthday_wishes_and_reactions.sql

The migrations enable Supabase Cron through the official SQL installation and then verify it before scheduling jobs. Do not rotate VAPID keys just to redeploy: installed devices are subscribed with the existing public key.

## Verification
- TypeScript, full existing test suite, upload/push tests, production build.
- PostgreSQL-compatible PGlite tests exercise profile access, approved challenge counts, actual storage policies, personal alarm scheduling, expiry, answer privacy, retries, birthday reactions/wishes, and ownership/audience boundaries.
- Run the database tests with PGLITE_MODULE_PATH pointing to an installed @electric-sql/pglite package:
  node scripts/profile-access-db.test.cjs
  node scripts/personal-alarms-db.test.cjs
  node scripts/birthday-conversations-db.test.cjs
- Browser screenshot verification could not run in this session: the browser connector had no available browser and standalone Chrome exited on launch.
- No production migration, live upload, or closed-phone delivery was verified in this implementation session.

After deployment, verify a profile in both themes, upload a challenge photo and Member Profile artwork, react/unreact and exchange birthday wishes across accounts, and set a personal alarm a few minutes ahead with the app closed. This last test is necessary on actual Android and iPhone devices.
