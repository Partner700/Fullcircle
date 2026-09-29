# Startup reliability, release v155

## Changes

- Cancel delayed backup downloads after the primary host responds successfully.
- Stop fetching every lazy game and administration screen at startup. Warm only
  the entry point and its static dependencies, with at most two background fetches.
- Deduplicate warming, reuse cached hashed assets, and delay warming until eight
  seconds after the page has loaded.
- Publish `release-manifest.json` at a readable URL. The Hostinger dot-directory
  manifest cannot be relied on, and another host's manifest may use different hashes.
- Return successful network responses independently of cache writes or storage
  failures. Cache reads have a short deadline.
- Reuse retained application shells during connection failures instead of choosing
  the current release's offline page before checking previous healthy shells.
- Activate workers without navigating healthy open windows. Limit automatic
  missing-bundle recovery to a same-origin retry, including when storage is denied.
- Hide installation controls from the initial render in standalone, minimal-ui,
  window-controls-overlay, fullscreen, iOS home-screen and Android TWA contexts.
  Keep installation available in a normal browser and respond to display-mode changes.
- Make the iOS installation instructions open from the persistent website button.

## Verification

- `npm run typecheck`
- `npm test`
- `npm run test:mobile` includes executable service-worker network/cache tests,
  first-render React installation tests, and reload-loop tests.
- `npm run lint -- --quiet`
- `npm run build`

The test scenarios cover failed and stalled primary requests, cancellation of
backup downloads, storage denial, quota errors, stalled cache operations, retained
shells, concurrent warming, HTML incorrectly returned for JavaScript, and update
activation without an unsolicited page reload. Existing generated release assets
are retained alongside the new build for clients still using older HTML.

## Release limitations

No database changes or account-data repair are included. The current execution
session blocks local server listening and GitHub DNS, and exposes no browser;
real-device browsing and public deployment could not be verified here. The fixes
address reproducible code defects, not a guarantee against carrier or host outages.

The accompanying `deploy-startup-reliability-release.sh` publishes the source to
the existing main repository and the built app to the existing GitHub Pages site.
