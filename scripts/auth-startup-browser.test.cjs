const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const browserRequire = process.env.PLAYWRIGHT_MODULE_ROOT
  ? createRequire(path.join(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json')) : require;
const { chromium } = browserRequire('playwright-core');

const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1', () => resolve(server));
});
const address = (server) => `http://127.0.0.1:${server.address().port}`;
const send = (res, type, body, status = 200) => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
};
const modules = {
  'entry-abc.js': 'export const identity = {}; globalThis.entryLoads = (globalThis.entryLoads || 0) + 1;',
  'screen-abc.js': "import {identity} from './entry-abc.js'; export {identity};",
};

async function testMirror(browser) {
  const mirror = await listen((req, res) => send(res, 'application/javascript', modules[path.basename(req.url)] || '', 200));
  const original = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  let repair = true;
  const primary = await listen((req, res) => {
    if (req.url.startsWith('/Full-Circle/sw.js')) {
      let worker = original.replace('https://raw.githack.com/TNSorganization/Full-Circle/gh-pages/', address(mirror) + '/');
      if (!repair) worker = worker.replace('resolve(localReleaseResponse(response, requestOrUrl))', 'resolve(response)');
      return send(res, 'application/javascript', worker);
    }
    if (req.url.includes('/assets/screen-')) return send(res, 'text/plain', 'simulated carrier failure', 503);
    if (req.url.includes('/assets/')) return send(res, 'application/javascript', modules[path.basename(req.url)] || '');
    return send(res, 'text/html', '<button id="load">Open screen</button><output id="result"></output>');
  });
  try {
    for (const scenario of ['old-worker', 'repaired-worker', 'old-cached-mirror']) {
      repair = scenario !== 'old-worker';
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(address(primary) + '/Full-Circle/');
      await page.evaluate(async () => {
        await navigator.serviceWorker.register('./sw.js');
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      });
      if (scenario === 'old-cached-mirror') {
        await page.evaluate(async (url) => {
          const cache = await caches.open('full-circle-v147-v155-assets');
          await cache.put(new URL('./assets/screen-abc.js', location.href), await fetch(url));
        }, address(mirror) + '/screen-abc.js');
      }
      const result = await page.evaluate(async () => {
        const entry = await import('./assets/entry-abc.js');
        const screen = await import('./assets/screen-abc.js');
        return { sameContext: entry.identity === screen.identity, entryLoads: globalThis.entryLoads };
      });
      assert.deepEqual(result, scenario === 'old-worker'
        ? { sameContext: false, entryLoads: 2 }
        : { sameContext: true, entryLoads: 1 }, scenario);
      console.log(`${scenario}: ${JSON.stringify(result)}`);
      await context.close();
    }
  } finally {
    primary.closeAllConnections(); mirror.closeAllConnections();
    await Promise.all([new Promise((r) => primary.close(r)), new Promise((r) => mirror.close(r))]);
  }
}

const mockAuth = `
export const supabaseConfigError = null;
let listener;
const session = { user: { id: 'test-user' }, access_token: 'test-only', refresh_token: 'test-only' };
window.authTest = { calls: 0, bootstraps: 0, role: 'cadet', emit: (event, value) => listener?.(event, value) };
export const supabase = {
  auth: {
    getSession: () => new Promise(resolve => {
      window.authTest.finishInit = () => resolve({data: {session: null}});
      if (!location.search.includes('late')) window.authTest.finishInit();
    }),
    onAuthStateChange: (fn) => { listener = fn; return {data: {subscription: {unsubscribe() {}}}}; },
    signInWithPassword: async ({password}) => {
      window.authTest.calls++;
      await new Promise(r => setTimeout(r, 80));
      if (password === 'wrongpass') return {data:{}, error:{message:'Invalid login credentials'}};
      if (password === 'networkfail') throw new Error('Sign-in timed out');
      listener('SIGNED_IN', session);
      return {data:{session, user:session.user}, error:null};
    },
    signUp: async () => ({data: {session, user: session.user}, error: null}),
    signOut: async () => { listener('SIGNED_OUT', null); return {error:null}; },
  },
  rpc(name) {
    if (name === 'complete_signup') return Promise.resolve({error:null});
    window.authTest.bootstraps++;
    return { abortSignal: () => new Promise(resolve => {
      const finish = () => resolve({data: {profile: {id:'test-user', display_name:'Test resident'}, role_assignment: {user_id:'test-user', role:window.authTest.role}}, error:null});
      window.authTest.finishProfile = finish;
      if (!location.search.includes('profile-slow')) setTimeout(finish, 60);
    })};
  }
};`;

const harness = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AuthProvider, useAuth} from '/src/context/AuthContext.tsx';
import {AuthScreen} from '/src/screens/AuthScreen.tsx';
import {AppErrorBoundary} from '/src/components/AppErrorBoundary.tsx';
import '/src/index.css';
function Screen() {
  const auth = useAuth();
  const [crashed, crash] = useState(false);
  if (crashed || window.authTest.alwaysCrash) throw new Error('Test dashboard failure');
  if (auth.loading) return <p>Restoring session</p>;
  if (!auth.session) return <AuthScreen/>;
  if (!auth.profile) return <p>Restoring account</p>;
  return <main><h1>{auth.role} dashboard</h1><button onClick={() => crash(true)}>Crash once</button><button onClick={() => {window.authTest.alwaysCrash = true; crash(true)}}>Crash repeatedly</button><button onClick={auth.signOut}>Sign out</button></main>;
}
createRoot(document.getElementById('root')).render(<AuthProvider><AppErrorBoundary><Screen/></AppErrorBoundary></AuthProvider>);`;

async function testAuth(browser) {
  const { createServer, transformWithEsbuild } = await import('vite');
  const vite = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'auth-regression-fixture', enforce: 'pre',
      resolveId(id) {
        if (id === '/auth-harness.jsx' || id === '../lib/supabase') return '\0' + id;
        if (id === '../lib/profileAccess' || id === '../lib/clientErrorReporting') return '\0' + id;
      },
      async load(id) {
        if (id === '\0/auth-harness.jsx') return (await transformWithEsbuild(harness, 'auth-harness.jsx', { loader: 'jsx' })).code;
        if (id === '\0../lib/supabase') return mockAuth;
        if (id === '\0../lib/profileAccess') return 'export const fetchOwnProfile = async () => null;';
        if (id === '\0../lib/clientErrorReporting') return 'export const reportClientError = () => {};';
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url.startsWith('/auth-test')) return next();
          send(res, 'text/html', '<div id="root"></div><script type="module" src="/auth-harness.jsx"></script>');
        });
      },
    }], esbuild: {jsx: 'automatic'} });
  await vite.listen();
  const url = address(vite.httpServer) + '/auth-test';
  try {
    for (const role of ['cadet', 'sentry', 'instructor']) {
      const context = await browser.newContext({ viewport: {width:390,height:844} });
      const page = await context.newPage();
      await page.goto(url);
      await page.locator('input[type=email]').fill('test@example.invalid');
      await page.locator('input[type=password]').fill('wrongpass');
      await page.locator('button[type=submit]').click();
      await page.getByRole('alert').filter({hasText:'Invalid login credentials'}).waitFor();
      assert.equal(await page.locator('input[type=email]').inputValue(), 'test@example.invalid');
      assert.equal(await page.locator('input[type=password]').inputValue(), 'wrongpass');
      await page.locator('input[type=password]').fill('networkfail');
      await page.locator('button[type=submit]').click();
      await page.getByRole('alert').filter({hasText:'connection took too long'}).waitFor();
      await page.evaluate((role) => {window.authTest.role = role;}, role);
      await page.locator('input[type=password]').fill('testpassword');
      await page.locator('button[type=submit]').click();
      await page.getByRole('heading', {name:role + ' dashboard'}).waitFor();
      await page.getByRole('button', {name:'Crash once',exact:true}).click();
      await page.getByRole('heading', {name:role + ' dashboard'}).waitFor();
      assert.equal(await page.evaluate(() => window.authTest.calls), 3, 'Retry must preserve the AuthProvider.');
      assert.equal(await page.evaluate(() => window.authTest.bootstraps), 1);
      console.log(`${role}: credential errors, network errors, successful login and crash recovery passed`);
      if (role === 'cadet') {
        await page.getByRole('button', {name:'Crash repeatedly'}).click();
        await page.waitForTimeout(5500);
        assert.equal(await page.getByText('We are reconnecting this screen').count(), 1);
        await page.screenshot({path: '/tmp/fullcircle-auth-recovery.png'});
      }
      await context.close();
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url + '?late&profile-slow');
    await page.locator('input[type=email]').waitFor({timeout:12000});
    await page.locator('input[type=email]').fill('test@example.invalid');
    await page.locator('input[type=password]').fill('testpassword');
    await page.locator('button[type=submit]').click();
    await page.getByText('Restoring account', {exact:true}).waitFor();
    await page.evaluate(() => {window.authTest.finishInit(); window.authTest.emit('INITIAL_SESSION', null);});
    await page.evaluate(() => window.authTest.finishProfile());
    await page.getByRole('heading', {name:'cadet dashboard'}).waitFor();
    console.log('Late startup null session cannot undo a successful sign-in; profile recovery passed');
    await context.close();
    const signupContext = await browser.newContext();
    const signup = await signupContext.newPage();
    await signup.goto(url);
    await signup.getByRole('button', {name:'Sign Up', exact:true}).click();
    await signup.locator('input[autocomplete=name]').fill('New resident');
    await signup.locator('input[type=email]').fill('new@example.invalid');
    await signup.locator('input[type=password]').nth(0).fill('testpassword');
    await signup.locator('input[type=password]').nth(1).fill('testpassword');
    await signup.locator('button[type=submit]').click();
    await signup.getByRole('heading', {name:'cadet dashboard'}).waitFor();
    console.log('New account setup reaches the authenticated dashboard');
    await signupContext.close();
  } finally { await vite.close(); }
}

async function testProduction(browser) {
  const server = await listen((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.join(root, 'dist', pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 'text/plain', 'Not found', 404);
    const types = {'.html':'text/html', '.js':'application/javascript', '.json':'application/json', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml'};
    send(res, types[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
  });
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({viewport:{width,height:844}});
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(address(server));
      await page.locator('input[type=email]').waitFor();
      await page.screenshot({path:`/tmp/fullcircle-login-${width}.png`});
      assert.equal(await page.locator('button[type=submit]').innerText(), 'Enter the Portal');
      assert.deepEqual(errors, []);
      console.log(`Production sign-in screen at ${width}px: rendered without runtime errors`);
      await context.close();
    }
  } finally {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true});
  try { await testMirror(browser); await testAuth(browser); await testProduction(browser); }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
