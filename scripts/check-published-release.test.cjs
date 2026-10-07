const assert = require('node:assert/strict');
const { checkSite } = require('./check-published-release.cjs');
const base = 'https://example.test/app/';
const expected = 'full-circle-target-v173';
const files = {
  'fc-worker.js': { status: 200, body: `const CACHE_VERSION = '${expected}';`, contentType: 'application/javascript' },
  'release-manifest.json': { status: 200, body: JSON.stringify({ 'index.html': { file: 'assets/index-host-build.js' } }), contentType: 'application/json' },
  'index.html': { status: 200, body: '<meta name="full-circle-release" content="173"><main id="root"></main><script type="module" src="./assets/index-host-build.js"></script>', contentType: 'text/html' },
  'full-circle-release.css': { status: 200, body: ':root{--full-circle-release-style:"173"}', contentType: 'text/css' },
  'assets/index-host-build.js': { status: 200, body: 'const app = true;', contentType: 'application/javascript' },
};
const read = (overrides = {}) => (url) => ({ ...files[new URL(url).pathname.slice(5)], ...overrides[new URL(url).pathname.slice(5)] });
assert.equal(checkSite(base, expected, read()).status, 'verified');
assert.equal(checkSite(base, expected, () => ({ error: 'Could not resolve host' })).status, 'unreachable');
assert.equal(checkSite(base, expected, () => ({ error: 'Connection timed out' })).status, 'unreachable');
assert.equal(checkSite(base, expected, read({ 'fc-worker.js': { body: "const CACHE_VERSION = 'full-circle-target-v167';" } })).status, 'different-release');
assert.equal(checkSite(base, expected, read({ 'release-manifest.json': { status: 404 } })).status, 'incomplete');
assert.equal(checkSite(base, expected, read({ 'release-manifest.json': { body: '<html>SPA fallback</html>' } })).status, 'incomplete');
assert.equal(checkSite(base, expected, read({ 'index.html': { body: '<script src="./assets/older.js"></script>' } })).status, 'incomplete');
assert.equal(checkSite(base, expected, read({ 'full-circle-release.css': { body: '<html>fallback</html>', contentType: 'text/html' } })).status, 'incomplete');
assert.equal(checkSite(base, expected, read({ 'assets/index-host-build.js': { body: '<html>fallback</html>', contentType: 'text/html' } })).status, 'incomplete');
assert.equal(checkSite(base, expected, read({ 'release-manifest.json': { body: JSON.stringify({ 'index.html': { file: 'https://unrelated.test/entry.js' } }) } })).status, 'incomplete');
console.log('Deployment verification distinguishes DNS/timeouts, stale releases, missing manifests and invalid bundles.');
