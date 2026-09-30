# Hostinger Deploy

This is a Vite React app. Hostinger should serve the built files from `dist`, not the repository root.

## Build

1. Create `.env` from `.env.example`.
2. Set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Run:

```bash
npm install
npm run build
```

## Upload

Upload the contents of `dist` into Hostinger's site root, usually `public_html`.

The deployed site root should contain:

- `index.html`
- `assets/`

It should not rely on `src/main.tsx` in production.

## Deployment connection

The current repository contains quality-check and GitHub Pages workflows, but
no active Hostinger FTPS deployment workflow. Pushing `main` therefore does not,
by itself, prove that Hostinger received the build. Hostinger must have a separate
connected Git deployment, or the built files must be uploaded using authenticated
hosting access. GitHub Pages publication does not update this domain.

For a connected Hostinger build, use `npm run build` and publish `dist`. That
command also prepares `.htaccess` and `release-manifest.json`. Avoid publishing
source files or skipping the postbuild step.

## Verify without republishing

```bash
node scripts/check-published-release.cjs dist
```

This read-only check compares the expected worker, the host's readable release
manifest, its HTML entry point and the JavaScript bundle on both public hosts.
It permits different build hashes between hosts. A DNS error or timeout is
reported as **unreachable**, not as evidence of an outdated deployment. An HTTP
error, invalid manifest, missing bundle or different worker is reported separately.
No account changes or database migrations are required for these checks.

## SPA Fallback

If direct routes show 404s, add this `.htaccess` file in `public_html`:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```
