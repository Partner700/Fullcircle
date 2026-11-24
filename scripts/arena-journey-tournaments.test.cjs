const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/lib/queries.ts'), 'utf8');
const ast = ts.createSourceFile('queries.ts', source, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'createInstructorArenaTournament');
assert.ok(fn, 'Tournament creation API exists');
const compiled = ts.transpileModule(fn.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let called;
let failure = null;
const scope = { exports: {}, supabase: { rpc: async (name, args) => { called = { name, args }; return { data: 'tournament-id', error: failure }; } } };
vm.runInNewContext(compiled, scope);
(async () => {
  const payload = { title: 'Journey Cup', playerIds: ['a', 'b'], gameTimes: ['2030-01-01'], hasGroups: false, gamePlayers: [['a','b','','']], bracketSize: 2 };
  assert.equal(await scope.exports.createInstructorArenaTournament({ ...payload, gameType: 'journey', journeyCharacterSlug: 'elisha' }), 'tournament-id');
  assert.equal(called.name, 'create_instructor_arena_tournament_lineups');
  assert.equal(called.args.p_game_type, 'journey');
  assert.equal(called.args.p_journey_character_slug, 'elisha');
  assert.deepEqual(JSON.parse(JSON.stringify(called.args.p_game_players)), [['a','b',null,null]]);
  for (const gameType of ['standard','ludo']) {
    await scope.exports.createInstructorArenaTournament({ ...payload, gameType });
    assert.equal(called.args.p_game_type, gameType);
    assert.equal(Object.hasOwn(called.args, 'p_journey_character_slug'), false, 'Old categories retain the compatible RPC signature');
  }
  failure = new Error('Choose a playable Journey narrative.');
  await assert.rejects(scope.exports.createInstructorArenaTournament({ ...payload, gameType: 'journey', journeyCharacterSlug: 'paused' }), /playable/);
  const ui = fs.readFileSync(path.join(root, 'src/components/InstructorArenaScheduler.tsx'), 'utf8');
  assert.match(ui, /value: 'journey', label: 'Journey Trivia'/);
  assert.match(ui, /items.filter\(\(character\) => character.ready\)/);
  assert.match(ui, /ariaLabel="Tournament Journey narrative"/);
  assert.match(ui, /journeyCharacterSlug: isJourney \? journeyCharacterSlug : null/);
  assert.match(ui, /journeyLoading \|\| journeyError \|\| !journeyReady/);
  console.log('Journey tournament UI contract and RPC payload tests passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
