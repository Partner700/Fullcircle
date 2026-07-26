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
