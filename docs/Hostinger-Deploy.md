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

## Automatic FTPS deployment

The `Deploy to Hostinger` GitHub Actions workflow uploads the committed `dist`
release after the `Quality checks` workflow succeeds on `main`. Add these
repository secrets in **GitHub → Settings → Secrets and variables → Actions**:

- `HOSTINGER_FTP_SERVER`
- `HOSTINGER_FTP_USERNAME`
- `HOSTINGER_FTP_PASSWORD`
- `HOSTINGER_FTP_SERVER_DIR` (the site document root, including leading and
  trailing slash, for example `/public_html/` or
  `/domains/fullcircle.partnertai.com/public_html/`)

Hostinger shows the first three values under **Websites → Manage → Files → FTP
Accounts**. Use the FTP account whose root can access this domain's
`public_html`. The workflow uses explicit FTPS on port 21 and does not delete
unrelated remote files.

After adding the secrets, open **GitHub → Actions → Deploy to Hostinger → Run
workflow** for the first deployment. Later successful pushes to `main` deploy
automatically.

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
