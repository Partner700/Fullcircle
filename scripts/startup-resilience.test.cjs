const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const scope = 'https://example.test/Full-Circle/';
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

function clock() {
  let now = 0, next = 0;
  const timers = new Map();
  return {
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      await flush();
      while (true) {
        const entry = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        now = entry[1].at;
        timers.delete(entry[0]);
        entry[1].fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

function memoryCaches() {
  const stores = new Map();
  const key = (url) => typeof url === 'string' ? url : url.url;
  return {
    stores,
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async put(url, response) { store.set(key(url), response.clone()); },
        async match(url) { return store.get(key(url))?.clone(); },
      };
    },
    async match(url) {
      for (const store of stores.values()) if (store.has(key(url))) return store.get(key(url)).clone();
    },
  };
}

function worker(fetcher, cache = memoryCaches()) {
  const time = clock(), requests = [], handlers = {}, navigation = [];
  const event = { jobs: [], waitUntil(promise) { this.jobs.push(promise); } };
  const context = vm.createContext({
    URL, Response, Headers, AbortController, console, caches: cache,
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    fetch: (request, options) => {
      const url = typeof request === 'string' ? request : request.url;
      requests.push({ url, options });
      return Promise.resolve().then(() => fetcher(url, options));
    },
    self: {
      registration: { scope }, location: new URL(scope), skipWaiting: async () => {},
      clients: { claim: async () => {}, matchAll: async () => [{ url: scope, navigate: (url) => navigation.push(url), postMessage() {} }] },
      addEventListener: (name, fn) => { handlers[name] = fn; },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'public/fc-worker.js'), 'utf8'), context);
  return {
    time, requests, handlers, event, navigation, cache,
    ...vm.runInContext('({fetchReleaseWithFallback, networkFirstNavigation, cacheFirstAsset, cachedAppShell, warmAppShell, criticalReleaseFiles, safeAppNavigationUrl, validReleaseResponse, isRecoveryNavigation, emergencyRecoveryResponse})', context),
  };
}

const response = (text = 'app', type = 'text/html') => new Response(text, { headers: { 'content-type': type } });
const appHtml = (text = 'app', release = '181') => `<!doctype html><html><head><meta name="full-circle-release" content="${release}"></head><body><main id="root">${text}</main></body></html>`;
const appResponse = (text = 'app', release = '181') => response(appHtml(text, release), 'text/html');
function mirrorResponse(url, text = 'export const loaded = true;') {
  const result = response(text, 'application/javascript');
  Object.defineProperty(result, 'url', { value: url });
  result.clone = () => mirrorResponse(url, text);
  return result;
}
const request = (path = 'index.html') => ({ url: scope + path });
const pendingUntilAborted = (signal) => new Promise((_, reject) => {
  if (signal.aborted) reject(new Error('aborted'));
  else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
});

async function run() {
  for (const cached of [false, true]) {
    const asset = request('assets/screen-abc.js');
    const cache = memoryCaches();
    const foreignUrl = 'https://raw.githack.com/TNSorganization/Full-Circle/gh-pages/assets/screen-abc.js';
    if (cached) await (await cache.open('full-circle-v147-v155-assets')).put(asset.url, mirrorResponse(foreignUrl));
    const w = worker(async (url) => {
      if (url.startsWith(scope)) throw new Error('Carrier failed');
      return mirrorResponse(url);
    }, cache);
    const delivered = await w.cacheFirstAsset(asset, w.event);
    assert.equal(delivered.url, '', 'Mirror responses, including old cached ones, must not change the module base URL.');
    assert.equal(new URL('./runtime-abc.js', delivered.url || asset.url).href, scope + 'assets/runtime-abc.js');
    assert.equal(await delivered.text(), 'export const loaded = true;');
    assert.equal(w.requests.length, cached ? 0 : 2);
  }
  {
    const w = worker(async () => appResponse());
    assert.match(await (await w.fetchReleaseWithFallback(request())).text(), />app</);
    await w.time.advance(15_000);
    assert.equal(w.requests.length, 1, 'Successful primary must cancel the backup timer.');
    assert.equal(w.requests[0].options.signal.aborted, false, 'Never abort the successful body.');
  }
  {
    const w = worker(async (url) => { if (url.startsWith(scope)) throw new Error('carrier failed'); return appResponse('backup'); });
    assert.match(await (await w.fetchReleaseWithFallback(request())).text(), />backup</);
    assert.equal(w.requests.length, 2, 'Primary failure should use one complete CDN copy without flooding the connection.');
  }
  {
    const w = worker((url, options) => url.startsWith(scope) ? pendingUntilAborted(options.signal) : appResponse('backup'));
    const load = w.fetchReleaseWithFallback(request());
    await w.time.advance(3000);
    assert.match(await (await load).text(), />backup</);
    assert.equal(w.requests[0].options.signal.aborted, true, 'Stop the losing stalled request.');
    await w.time.advance(15_000);
    assert.equal(w.requests[1].options.signal.aborted, false);
  }
  {
    const w = worker((url, options) => {
      if (!url.startsWith(scope)) return response('complete backup', 'application/javascript');
      const headersOnly = appResponse('unused');
      headersOnly.clone = () => ({ arrayBuffer: () => pendingUntilAborted(options.signal) });
      return headersOnly;
    });
    const load = w.fetchReleaseWithFallback(request('assets/entry-abcd.js'));
    await w.time.advance(3000);
    assert.equal(await (await load).text(), 'complete backup', 'Headers without a complete body must never win the release race.');
    assert.equal(w.requests[0].options.signal.aborted, true, 'The incomplete primary body must be stopped after a complete mirror wins.');
  }
  {
    const w = worker((_, options) => pendingUntilAborted(options.signal));
    const result = w.fetchReleaseWithFallback(request()).then(() => 'bad', () => 'failed');
    await w.time.advance(25_000);
    assert.equal(await result, 'failed', 'Both failed routes have a bounded deadline.');
  }
  for (const behavior of ['denied', 'quota', 'stalled']) {
    const cache = memoryCaches();
    cache.open = async () => {
      if (behavior === 'denied') throw new Error('Storage denied');
      return { put: () => behavior === 'stalled' ? new Promise(() => {}) : Promise.reject(new Error('Quota exceeded')) };
    };
    cache.match = () => behavior === 'stalled' ? new Promise(() => {}) : Promise.reject(new Error('Storage denied'));
    const w = worker(async (url) => response(
      url.includes('/assets/') ? 'healthy' : appHtml('healthy'),
      url.includes('/assets/') ? 'application/javascript' : 'text/html',
    ), cache);
    assert.match(await (await w.networkFirstNavigation(request(), w.event)).text(), /healthy/);
    const asset = w.cacheFirstAsset(request('assets/entry-abcd.js'), w.event);
    await w.time.advance(200);
    assert.equal(await (await asset).text(), 'healthy', `${behavior} cache must not block network assets.`);
  }
  {
    const cache = memoryCaches();
    await (await cache.open('full-circle-v147-v158-shell')).put(scope + 'index.html', response('restricted-project app'));
    await (await cache.open('full-circle-target-v176-shell')).put(scope + 'index.html', appResponse('broken release 176 shell', '176'));
    const w = worker(async () => { throw new Error('offline'); }, cache);
    w.handlers.activate(w.event);
    await Promise.all(w.event.jobs);
    assert.ok(!(await cache.keys()).includes('full-circle-v147-v158-shell'), 'Pre-cutover shells must be deleted.');
    assert.ok(!(await cache.keys()).includes('full-circle-target-v176-shell'), 'The Release 176 loop must be removed from affected phones.');
    assert.equal(w.navigation.length, 1, 'A client carrying a pre-cutover shell must be refreshed once.');
    assert.equal(new URL(w.navigation[0]).searchParams.get('fc-worker'), '181');
    assert.notEqual(await (await w.networkFirstNavigation(request(), w.event)).text(), 'restricted-project app');
  }
  {
    const cache = memoryCaches();
    await (await cache.open('full-circle-target-v181-shell')).put(scope + 'index.html', appResponse('current target app'));
    const w = worker(async () => { throw new Error('offline'); }, cache);
    w.handlers.activate(w.event);
    await Promise.all(w.event.jobs);
    assert.equal(w.navigation.length, 0, 'A current target release must not interrupt an active quiz or draft.');
    assert.match(await (await w.networkFirstNavigation(request(), w.event)).text(), /current target app/);
  }
  {
    const manifest = {
      'index.html': { file: 'assets/index-abc.js', imports: ['runtime'], css: ['assets/main-abc.css'], dynamicImports: ['instructor', 'game'] },
      runtime: { file: 'assets/runtime-abc.js' },
      instructor: { file: 'assets/instructor-abc.js' }, game: { file: 'assets/game-abc.js' },
    };
    let active = 0, peak = 0;
    const cache = memoryCaches();
    await (await cache.open('full-circle-v147-v154-assets')).put(scope + 'assets/runtime-abc.js', response('runtime', 'application/javascript'));
    const w = worker(async (url) => {
      active++; peak = Math.max(peak, active);
      await flush(); active--;
      if (url.endsWith('release-manifest.json')) return response(JSON.stringify(manifest), 'application/json');
      if (url.endsWith('index.html')) return appResponse('ok');
      if (url.endsWith('full-circle-release.css')) return response(':root{}', 'text/css');
      return response('ok', 'application/javascript');
    }, cache);
    const first = w.warmAppShell();
    assert.equal(w.warmAppShell(), first, 'Warming must be single-flight.');
    await first;
    const urls = w.requests.map((item) => item.url);
    assert.ok(!urls.some((url) => /instructor|game|runtime|\.vite/.test(url)));
    assert.ok(urls.includes(scope + 'assets/index-abc.js'));
    assert.ok(urls.includes(scope + 'full-circle-release.css'));
    assert.ok(peak <= 2, 'Background warm concurrency must be bounded.');
    await w.warmAppShell();
    assert.equal(w.requests.length, urls.length, 'Repeated launches must not flood the network.');
    await w.time.advance(15_000);
    assert.equal(w.requests.length, urls.length, 'Warming must not launch stray backup requests.');
  }
  {
    const w = worker(async (url) => url.startsWith(scope) ? response('<html>SPA fallback</html>') : response('valid JS', 'application/javascript'));
    assert.equal(await (await w.cacheFirstAsset(request('assets/missing-abcd.js'), w.event)).text(), 'valid JS');
  }
  {
    const w = worker(async (url) => {
      assert.equal(url, scope + 'index.html', 'A tab stranded on a bundle URL must request the app document.');
      return appResponse('Full Circle');
    });
    const delivered = await w.networkFirstNavigation({
      url: scope + 'assets/retired-entry.js',
      mode: 'navigate',
    }, w.event);
    assert.match(await delivered.text(), /Full Circle/);
    assert.match(delivered.headers.get('content-type'), /text\/html/);
  }
  {
    const w = worker(async (url) => (
      url.startsWith(scope)
        ? response('<!doctype html><title>Temporary host error</title>', 'text/html')
        : appResponse('verified mirror shell')
    ));
    const delivered = await w.fetchReleaseWithFallback(request());
    assert.match(await delivered.text(), /verified mirror shell/, 'An HTML error page without the release marker must never become the app shell.');
  }
  {
    const cache = memoryCaches();
    await (await cache.open('full-circle-target-v181-shell')).put(
      scope + 'index.html',
      response('<html><main id="root">proxy error</main></html>', 'text/html'),
    );
    const w = worker(async () => { throw new Error('offline'); }, cache);
    assert.equal(await w.cachedAppShell(), null, 'Unmarked cached HTML must be rejected.');
  }
  {
    const w = worker(async () => appResponse());
    assert.equal(await w.validReleaseResponse(appResponse('future release', '181'), request()), true, 'A verified newer shell must not be rejected by an older worker.');
    assert.equal(await w.validReleaseResponse(appResponse('previous safe release', '177'), request()), true, 'The previous safe shell remains usable during an interrupted update.');
    assert.equal(await w.validReleaseResponse(appResponse('retired release', '176'), request()), false, 'The broken retired shell must never be accepted again.');
  }
  {
    const cache = memoryCaches();
    await (await cache.open('full-circle-target-v181-shell')).put(scope + 'index.html', appResponse('cached shell'));
    const w = worker(async () => appResponse('fresh network shell'), cache);
    const delivered = await w.networkFirstNavigation({
      url: scope + '?fc-repair=181',
      mode: 'navigate',
    }, w.event);
    assert.match(await delivered.text(), /fresh network shell/, 'A recovery navigation must bypass the cached shell.');
  }
  {
    const cache = memoryCaches();
    await cache.open('full-circle-target-v181-shell');
    await cache.open('full-circle-target-v176-assets');
    const w = worker(async () => appResponse(), cache);
    const resetEvent = { data: { type: 'RESET_APP_SHELL' }, jobs: [], waitUntil(promise) { this.jobs.push(promise); } };
    w.handlers.message(resetEvent);
    await Promise.all(resetEvent.jobs);
    assert.deepEqual(await cache.keys(), [], 'A manual reset must remove the current broken shell as well as retired caches.');
    assert.doesNotMatch(await w.emergencyRecoveryResponse().text(), /location\.reload\(\)/, 'The emergency retry must not repeat an ordinary reload loop.');
  }
  {
    const w = worker(async () => appResponse());
    assert.equal(w.safeAppNavigationUrl(scope + 'assets/index-old.js'), scope);
    assert.equal(w.safeAppNavigationUrl('https://unrelated.test/app'), scope);
    assert.equal(w.safeAppNavigationUrl(scope + '?screen=quiz'), scope + '?screen=quiz');
  }
  testDisplayModes();
  await testRecovery();
  console.log('Startup regression checks passed: network hedging, release compatibility, hard cache escape, bounded warming, install modes and recovery loops.');
}

function loadTs(relative, globals) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = vm.createContext({ exports: {}, URL, console, ...globals });
  vm.runInContext(compiled, context);
  return context.exports;
}

function testDisplayModes() {
  for (const mode of ['standalone', 'minimal-ui', 'window-controls-overlay', 'fullscreen', 'ios', 'twa', 'browser']) {
    const globals = {
      window: { navigator: { standalone: mode === 'ios' }, matchMedia: (query) => ({ matches: query === `(display-mode: ${mode})` }) },
      document: { referrer: mode === 'twa' ? 'android-app://com.fullcircle/' : '' },
    };
    const displayMode = loadTs('src/lib/appDisplayMode.ts', globals);
    assert.equal(displayMode.isInstalledApp(), mode !== 'browser', mode);
    const { PWAInstallPrompt } = loadTs('src/components/PWAInstallPrompt.tsx', {
      ...globals,
      require(name) {
        if (name === '../lib/appDisplayMode') return displayMode;
        if (name === './Dove') return { Dove: () => null };
        return require(name);
      },
    });
    const markup = renderToStaticMarkup(React.createElement(PWAInstallPrompt));
    assert.equal(markup.includes('Install / Reinstall'), mode === 'browser', `${mode}: actual first render must hide the entire install UI in the app.`);
  }
}

async function testRecovery() {
  const redirects = [];
  const window = {
    location: { href: scope, replace(url) { this.href = url; redirects.push(url); }, reload() { throw new Error('Unexpected reload'); } },
    get sessionStorage() { throw new Error('Storage denied'); },
  };
  const globals = { window, navigator: { serviceWorker: { getRegistration: () => new Promise(() => {}) } } };
  const first = loadTs('src/lib/staleBundleRecovery.ts', globals);
  assert.equal(first.recoverFromStaleBundle('Load failed'), false, 'API failures must not reload the app.');
  assert.equal(first.recoverFromStaleBundle('Failed to fetch dynamically imported module'), true);
  await flush();
  assert.equal(redirects.length, 1, 'A stalled worker lookup must not block a manual retry.');
  assert.equal(new URL(redirects[0]).origin, new URL(scope).origin, 'Automatic retries must preserve the signed-in origin.');
  const reloaded = loadTs('src/lib/staleBundleRecovery.ts', globals);
  assert.equal(reloaded.recoverFromStaleBundle('vite:preloadError'), false, 'URL loop guard must survive reload without storage.');
  assert.equal(redirects.length, 1);
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
