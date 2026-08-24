# Full Circle Production Recovery

The independent production address is:

- `https://tnsorganization.github.io/Full-Circle/`

It does not depend on Hostinger, its FTP account, or the `partnertai.com` DNS
zone. GitHub Pages serves the built application directly from the `gh-pages`
branch of `TNSorganization/Full-Circle`.

## Automatic recovery

The mirror repository runs `Keep Full Circle Online` every ten minutes. It
checks the public release, publishes a newer production build when available,
and republishes its independent recovery copy if the primary repository cannot
be reached. A failed update leaves the last working release online.

## Manual recovery

Run this from Terminal when an immediate publication is needed:

```bash
bash /Users/bameelhakol/Documents/Codex/2026-07-23/los/publish-fullcircle-without-hostinger.sh
```

The script publishes the current `dist` build directly to `gh-pages`, selects
branch-based GitHub Pages, requests a build, and waits until the exact release
asset is visible at the public address.

## Installation

Every browser visit offers installation automatically once per session. A
compact **Install** control remains available until the app is installed.
Chromium browsers use the native installation prompt; iPhone and iPad users see
the Safari **Add to Home Screen** instructions; in-app browsers receive steps
for opening the site in a browser that supports installation.

For password-reset emails to return to this address, add its URL pattern under
**Supabase → Authentication → URL Configuration → Redirect URLs**. For the
TNS-owned mirror, use `https://tnsorganization.github.io/Full-Circle/**`. Normal
email-and-password sign-in does not need that additional redirect entry.
