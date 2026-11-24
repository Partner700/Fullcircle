const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

(async () => {
  let handler;
  const requests = [];
  const source = fs.readFileSync('supabase/functions/biblical-journey/index.ts', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    exports: {}, require: () => ({}), Response, Request, console,
    Deno: { env: { get: (name) => name === 'SUPABASE_URL' ? 'https://local.test' : 'test-only' }, serve: (callback) => { handler = callback; } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return Response.json([
        { slug: 'elisha', display_name: 'Elisha', ready: true },
        { slug: 'moses', display_name: 'Moses', ready: false },
      ]);
    },
  });
  const response = await handler(new Request('https://local.test/functions/v1/biblical-journey', {
    method: 'POST', body: JSON.stringify({ action: 'CATALOG' }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { characters: [
    { slug: 'elisha', displayName: 'Elisha', ready: true },
    { slug: 'moses', displayName: 'Moses', ready: false },
  ] });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://local.test/rest/v1/arena_journey_characters?select=slug,display_name,ready&order=display_name.asc');
  assert.equal(requests[0].options.method, undefined, 'Catalog performs no writes');
  assert.match(source, /ready=eq.true&select=slug/, 'Starting a game still requires a playable bank');
  assert.match(source, /authenticatedUserId\(request\)/, 'Game commands retain authentication');
  const arena = fs.readFileSync('src/screens/cadet/CadetArena.tsx', 'utf8');
  assert.match(arena, /fetchJourneyCatalog\(\)/);
  assert.match(arena, /Not yet playable/);
  assert.match(arena, /disabled=\{creating[^}]+journeyCharacterSlug && item.ready/);
  console.log('Public catalog includes unavailable narratives without exposing questions or bypassing readiness.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
