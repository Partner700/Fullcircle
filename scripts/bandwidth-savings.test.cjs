const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function load(file, extras = {}) {
  const exports = {};
  const context = vm.createContext({ exports, console, File, Blob, Date, ...extras });
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInContext(output, context);
  return exports;
}

async function testImageBudgets() {
  let width = 1000;
  let height = 700;
  let closed = 0;
  let encodes = 0;
  let mime = 'image/webp';
  let oversized = false;
  const canvas = {
    width: 0, height: 0, getContext: () => ({ drawImage() {} }),
    toBlob(callback) {
      encodes++;
      callback(new Blob([new Uint8Array(oversized ? 1024 * 1024 : Math.ceil(canvas.width * canvas.height * 0.8))], { type: mime }));
    },
  };
  const uploads = load('src/lib/uploads.ts', {
    createImageBitmap: async () => ({ width, height, close: () => closed++ }),
    document: { createElement: () => canvas },
  });
  const photo = new File([new Uint8Array(700 * 1024)], 'camera.jpg', { type: 'image/jpeg' });
  const artwork = await uploads.prepareImageUpload(photo);
  assert.ok(artwork.file.size <= 512 * 1024, 'Old 900 KB bypass must not bypass the output budget');
  assert.ok(encodes >= 2, 'Reduce again if the first encoded image is too large');
  width = 4000; height = 3000;
  const avatar = await uploads.prepareImageUpload(photo, uploads.AVATAR_UPLOAD_OPTIONS);
  assert.ok(canvas.width <= 640 && canvas.height <= 640);
  assert.ok(avatar.file.size <= 160 * 1024);
  mime = 'image/png';
  const fallback = await uploads.prepareImageUpload(photo);
  assert.equal(fallback.extension, 'png');
  assert.equal(fallback.file.type, 'image/png');
  assert.ok(fallback.file.size <= 512 * 1024, 'Safari encoder fallback still respects the budget');
  width = 200; height = 100;
  const small = new File(['already small'], 'small.png', { type: 'image/png' });
  const before = encodes;
  assert.equal((await uploads.prepareImageUpload(small)).file, small);
  assert.equal(encodes, before, 'Do not needlessly re-encode small images');
  oversized = true;
  await assert.rejects(uploads.prepareImageUpload(photo), /could not be reduced/);
  assert.equal(closed, 5, 'Release decoded images on both success and failure');
  console.log('Image output budgets, MIME fallback, small-file reuse and cleanup passed');
}

async function testReadCache() {
  let now = 1000;
  const { createReadCache } = load('src/lib/readCache.ts', { Date: { now: () => now } });
  const cache = createReadCache(60_000, 2);
  let calls = 0;
  const read = () => Promise.resolve(++calls);
  const first = cache.read('cadet-art', read);
  assert.equal(cache.read('cadet-art', read), first, 'In-flight reads share one request');
  assert.equal(await first, 1);
  assert.equal(await cache.read('cadet-art', read), 1);
  assert.equal(await cache.read('sentry-art', read), 2, 'Different audiences stay separate');
  now += 60_001;
  assert.equal(await cache.read('cadet-art', read), 3, 'Settings expire');
  let finish;
  const oldRead = cache.read('pending', () => new Promise(resolve => { finish = resolve; }));
  await flush();
  cache.clear();
  assert.equal(await cache.read('pending', read), 4);
  finish('old account data');
  await oldRead;
  assert.equal(await cache.read('pending', read), 4, 'Late requests cannot refill an invalidated cache');
  await assert.rejects(cache.read('error', () => Promise.reject(new Error('restricted'))), /restricted/);
  assert.equal(await cache.read('error', read), 5, 'Errors must not be saved as empty settings');
  await cache.read('third', read);
  assert.equal(await cache.read('pending', read), 7, 'Cache size is bounded');
  console.log('Artwork read reuse, expiration, isolation, invalidation and failure recovery passed');
}

async function testVisiblePolling() {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  const events = () => {
    const listeners = new Map();
    return {
      addEventListener: (key, fn) => { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(fn); },
      removeEventListener: (key, fn) => listeners.get(key)?.delete(fn),
      fire: key => listeners.get(key)?.forEach(fn => fn()),
    };
  };
  const document = { ...events(), visibilityState: 'visible' };
  const navigator = { onLine: true };
  const window = { ...events(),
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, {fn, due: now + delay}); return id; },
    clearTimeout: id => timers.delete(id),
  };
  const advance = async (time) => {
    now += time;
    for (const [id, timer] of [...timers]) {
      if (timer.due <= now && timers.has(id)) { timers.delete(id); timer.fn(); }
    }
    await flush();
  };
  const { startVisiblePolling } = load('src/lib/visiblePolling.ts', { document, navigator, window, Date: {now: () => now} });
  let calls = 0;
  let release;
  let hold = false;
  const polling = startVisiblePolling(async () => {
    calls++;
    if (hold) await new Promise(resolve => { release = resolve; });
  }, 60_000);
  await flush();
  assert.equal(calls, 1);
  document.visibilityState = 'hidden'; document.fire('visibilitychange');
  await advance(5 * 60_000);
  polling.refresh(); await flush();
  assert.equal(calls, 1, 'Hidden tabs must not download data, including realtime refresh callbacks');
  document.visibilityState = 'visible'; document.fire('visibilitychange'); await flush();
  assert.equal(calls, 2, 'Returning to the app fetches fresh data');
  navigator.onLine = false; window.fire('offline'); await advance(60_000);
  assert.equal(calls, 2);
  navigator.onLine = true; window.fire('online'); await flush();
  assert.equal(calls, 3);
  hold = true; await advance(60_000);
  polling.refresh(); polling.refresh(); await advance(60_000);
  assert.equal(calls, 4, 'A slow network cannot create overlapping polls');
  hold = false; release(); await flush(); await advance(1000);
  assert.equal(calls, 5, 'Realtime changes during a pending read get one follow-up');
  polling.stop(); await advance(60_000); window.fire('online'); polling.refresh(); await flush();
  assert.equal(calls, 5); assert.equal(timers.size, 0);
  console.log('Hidden/offline pause, foreground catch-up, request coalescing and disposal passed');
}

(async () => {
  await testImageBudgets();
  await testReadCache();
  await testVisiblePolling();
})().catch(error => { console.error(error); process.exitCode = 1; });
