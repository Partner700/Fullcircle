# Award releases

In **Instructor > Awards**, select a recommended winner or nominee, or choose any
eligible recipient in **Give an Award**. All catalog awards remain selectable,
including monthly, annual, sentry, and collective tent honors.

Use **Add to release** for each award/recipient selection. The release can contain
different awards for different people and tents. Review the list, then either
publish together or choose one future date and time. Times are Cameroon time
(`Africa/Douala`), regardless of the instructor's device timezone.

Scheduled releases are stored in the database. The instructor need not remain
online. They can be rescheduled or cancelled while pending. Failed releases show
the reason and can be rescheduled after correcting the recipient/tent issue.

## Publication guarantees

- Only instructors can read unpublished selections or schedule/change releases.
- The Cron job `full-circle-award-releases` checks once per minute.
- A batch commits all its awards and recipient notifications together, or none.
- Weekly cycle keys use the scheduled Cameroon date. Monthly and annual awards
  keep the selected award month, consistent with existing award records.
- Retrying the same request, rerunning the worker, or encountering an existing
  award cannot create another copy of that award or duplicate its notification.
- Existing award feeds, reactions, profile badges, and monthly honors continue
  reading the same `awards` table. No unreleased award is inserted into that table.
- Choosing a nominee is an instructor selection action, not a public nomination
  announcement. The selected recipient receives the award when it is released.

## Verification

Run `npm run typecheck`, `npm test`, `npm run test:mobile`, and `npm run lint`.
Database behavior can be checked with:

```sh
PGLITE_MODULE_PATH=/path/to/@electric-sql/pglite node scripts/award-releases-db.test.cjs
```

The database tests execute the migration functions with isolated fixtures. They
cover every award/recipient category, authentication and RLS, time boundaries,
early/late worker execution, retries, cancellation, failed-batch recovery,
mid-publication rollback, and notification deduplication. Cron installation is
verified separately against the deployed database; PGlite does not run pg_cron.

Browser checks use mocked API responses, never real award assignments. They cover
winner/nominee selection, all 26 catalog/category combinations, mixed-recipient
batches, scheduling, rescheduling, cancellation, and mobile/desktop overflow.
