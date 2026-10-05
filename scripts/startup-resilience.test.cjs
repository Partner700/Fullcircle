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
    ...vm.runInContext('({fetchReleaseWithFallback, networkFirstNavigation, cacheFirstAsset, cachedAppShell, warmAppShell, criticalReleaseFiles})', context),
  };
}

const response = (text = 'app', type = 'text/html') => new Response(text, { headers: { 'content-type': type } });
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
    assert.equal(w.requests.length, cached ? 0 : 3);
  }
  {
    const w = worker(async () => response());
    assert.equal(await (await w.fetchReleaseWithFallback(request())).text(), 'app');
    await w.time.advance(15_000);
    assert.equal(w.requests.length, 1, 'Successful primary must cancel the backup timer.');
    assert.equal(w.requests[0].options.signal.aborted, false, 'Never abort the successful body.');
  }
  {
    const w = worker(async (url) => { if (url.startsWith(scope)) throw new Error('carrier failed'); return response('backup'); });
    assert.equal(await (await w.fetchReleaseWithFallback(request())).text(), 'backup');
    assert.equal(w.requests.length, 3, 'Primary failure should start both independent backups immediately.');
  }
  {
    const w = worker((url, options) => url.startsWith(scope) ? pendingUntilAborted(options.signal) : response('backup'));
    const load = w.fetchReleaseWithFallback(request());
    await w.time.advance(1800);
    assert.equal(await (await load).text(), 'backup');
    assert.equal(w.requests[0].options.signal.aborted, true, 'Stop the losing stalled request.');
    await w.time.advance(15_000);
    assert.equal(w.requests[1].options.signal.aborted, false);
  }
  {
    const w = worker((_, options) => pendingUntilAborted(options.signal));
    const result = w.fetchReleaseWithFallback(request()).then(() => 'bad', () => 'failed');
    await w.time.advance(12_500);
    assert.equal(await result, 'failed', 'Both failed routes have a bounded deadline.');
  }
  for (const behavior of ['denied', 'quota', 'stalled']) {
    const cache = memoryCaches();
    cache.open = async () => {
      if (behavior === 'denied') throw new Error('Storage denied');
      return { put: () => behavior === 'stalled' ? new Promise(() => {}) : Promise.reject(new Error('Quota exceeded')) };
    };
    cache.match = () => behavior === 'stalled' ? new Promise(() => {}) : Promise.reject(new Error('Storage denied'));
    const w = worker(async () => response('healthy', 'application/javascript'), cache);
    assert.equal(await (await w.networkFirstNavigation(request(), w.event)).text(), 'healthy');
    const asset = w.cacheFirstAsset(request('assets/entry-abcd.js'), w.event);
    await w.time.advance(200);
    assert.equal(await (await asset).text(), 'healthy', `${behavior} cache must not block network assets.`);
  }
  {
    const cache = memoryCaches();
    await (await cache.open('full-circle-v147-v158-shell')).put(scope + 'index.html', response('restricted-project app'));
    const w = worker(async () => { throw new Error('offline'); }, cache);
    w.handlers.activate(w.event);
    await Promise.all(w.event.jobs);
    assert.ok(!(await cache.keys()).includes('full-circle-v147-v158-shell'), 'Pre-cutover shells must be deleted.');
    assert.equal(w.navigation.length, 1, 'A client carrying a pre-cutover shell must be refreshed once.');
    assert.equal(new URL(w.navigation[0]).searchParams.get('fc-worker'), '163');
    assert.notEqual(await (await w.networkFirstNavigation(request(), w.event)).text(), 'restricted-project app');
  }
  {
    const cache = memoryCaches();
    await (await cache.open('full-circle-target-v163-shell')).put(scope + 'index.html', response('current target app'));
    const w = worker(async () => { throw new Error('offline'); }, cache);
    w.handlers.activate(w.event);
    await Promise.all(w.event.jobs);
    assert.equal(w.navigation.length, 0, 'A current target release must not interrupt an active quiz or draft.');
    assert.equal(await (await w.networkFirstNavigation(request(), w.event)).text(), 'current target app');
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
      return url.endsWith('release-manifest.json') ? response(JSON.stringify(manifest), 'application/json') : response('ok', 'application/javascript');
    }, cache);
    const first = w.warmAppShell();
    assert.equal(w.warmAppShell(), first, 'Warming must be single-flight.');
    await first;
    const urls = w.requests.map((item) => item.url);
    assert.ok(!urls.some((url) => /instructor|game|runtime|\.vite/.test(url)));
    assert.ok(urls.includes(scope + 'assets/index-abc.js'));
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
  testDisplayModes();
  await testRecovery();
  console.log('Startup regression checks passed: network hedging, storage failures, target-only shell recovery, bounded warming, install modes and recovery loops.');
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
