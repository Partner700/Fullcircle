#!/usr/bin/env bash
# Full Circle v3 private database backup. Requires age, pg_dump, aws CLI,
# a private versioned S3 destination and operator-managed secrets.
# NEVER upload this encrypted output to public GitHub Actions artifacts.
set -euo pipefail
: "${SUPABASE_DB_URL:?Provide a scoped Postgres connection string privately}"
: "${BACKUP_AGE_RECIPIENT:?Set an age public encryption recipient}"
: "${FULL_CIRCLE_PRIVATE_BACKUP_S3_URI:?Set a private s3://bucket/prefix destination}"
for binary in pg_dump age aws; do
  command -v "$binary" >/dev/null || { echo "Missing required tool: $binary" >&2; exit 1; }
done
case "$FULL_CIRCLE_PRIVATE_BACKUP_S3_URI" in
  s3://*) ;;
  *) echo "Backup destination must be a private S3 bucket" >&2; exit 1 ;;
esac
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$tmpdir/full-circle-v3-$stamp.dump"
sealed="$archive.age"
# Export all accessible schemas. Check pg_dump version compatibility and
# run a staging restore drill; managed Postgres roles/storage binaries
# are not included in this logical backup.
pg_dump --dbname="$SUPABASE_DB_URL" --format=custom --no-owner --no-acl --file="$archive"
test -s "$archive"
age -r "$BACKUP_AGE_RECIPIENT" -o "$sealed" "$archive"
test -s "$sealed"
aws s3 cp "$sealed" "${FULL_CIRCLE_PRIVATE_BACKUP_S3_URI%/}/$(basename "$sealed")" --sse AES256 --only-show-errors
echo "Encrypted private backup uploaded: $stamp"
