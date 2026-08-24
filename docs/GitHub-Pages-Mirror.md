# GitHub Pages Mirror

Full Circle can be served at `https://partner700.github.io/Fullcircle/` without
using Hostinger or the `partnertai.com` DNS zone.

## One-time activation

1. Open `Partner700/Fullcircle` on GitHub.
2. Open **Settings**, then **Pages** under **Code and automation**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Open **Actions**, select **Deploy Full Circle mirror**, and run it if the
   latest push has not already started it.

Every later push to `main` rebuilds and publishes the mirror automatically.
The mirror uses the repository path as its application base and deploys one
executable release file, so it does not depend on Hostinger's file upload order.

For password-reset emails to return to the mirror, add
`https://partner700.github.io/Fullcircle/**` under **Supabase → Authentication →
URL Configuration → Redirect URLs**. Normal email-and-password sign-in does not
need that additional redirect entry.
