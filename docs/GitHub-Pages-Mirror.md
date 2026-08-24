# GitHub Pages Mirror

Full Circle can be served from any GitHub repository without using Hostinger or
the `partnertai.com` DNS zone. The workflow derives the site path from the
repository name, so both of these mirrors are supported:

- `https://partner700.github.io/Fullcircle/`
- `https://tnsorganization.github.io/Full-Circle/`

## One-time activation

1. Open the repository that will host the mirror. Use
   `TNSorganization/Full-Circle` when Partner700's Pages settings are not
   available to your account.
2. Open **Settings**, then **Pages** under **Code and automation**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Open **Actions**, select **Deploy Full Circle mirror**, and run it if the
   latest push has not already started it.

Every later push to `main` rebuilds and publishes that repository's mirror
automatically.
The mirror uses the repository path as its application base and deploys one
executable release file, so it does not depend on Hostinger's file upload order.

For password-reset emails to return to a mirror, add its URL pattern under
**Supabase → Authentication → URL Configuration → Redirect URLs**. For the
TNS-owned mirror, use `https://tnsorganization.github.io/Full-Circle/**`. Normal
email-and-password sign-in does not need that additional redirect entry.
