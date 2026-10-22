# Photo Storage Access Repair

The existing frontend compresses avatars to at most 640 pixels and 160 KiB before uploading. Its `upsert: true` storage request requires INSERT, SELECT and UPDATE policies. A public bucket alone does not authorize uploads.

The October project export excludes the managed `storage` schema. Its saved application schema contains no `storage.objects` policies. The copy/readiness scripts restore buckets and files but do not restore these policies or test a signed-in upload. Migration history alone therefore does not establish that the storage access rules survived the copy. This is a likely cause of the reported permission message; live rules must still be inspected by the repair command.

This migration restores the previously defined avatar-folder and instructor-panel rules, plus their table privileges. It preserves row security, bucket settings, existing files, profiles and all game data. Users can upload only below their own user ID; only instructors can upload shared panel images and weekly backgrounds. Other policies are left alone. No website build, new link, photo deletion or broad migration replay is required.

`repair-photo-storage-access.sh` pins the target project, prints and saves a read-only permissions report, rehearses the single migration with rollback, then asks for confirmation before applying. It records the migration and merges/pushes the corresponding source commit without republishing the app. Retry skips an installed migration. The last verification is an actual profile-picture upload in the app; local SQL tests cannot prove a live Storage HTTP upload.

Validation:

```sh
PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/photo-storage-postgres.test.mjs
node scripts/profile-alarm-uploads.test.cjs
```

Reference: https://supabase.com/docs/guides/storage/security/access-control
