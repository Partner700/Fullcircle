const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
let requestedTab = 'journey_questions';
const emptyComponents = new Proxy({}, { get: () => () => null });
let journeyModule;

function loadComponent(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  const mockedRequire = (name) => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name.endsWith('/AuthContext')) return { useAuth: () => ({ profile: { id: 'instructor-1', display_name: 'Instructor' } }) };
    if (name.endsWith('/appContinuity')) return { readContinuedTab: (_id, _role, allowed) => {
      assert.ok(allowed.includes(requestedTab), 'The instructor route must be available in navigation.');
      return requestedTab;
    } };
    if (name.endsWith('/InstructorJourneyReview')) return journeyModule;
    if (name.endsWith('/AppShell')) return {
      AppShell: ({ navItems, children }) => React.createElement('main', null,
        React.createElement('nav', null, navItems.map((item) => React.createElement('button', { key: item.key }, item.label))), children),
      SectionHeader: ({ title }) => React.createElement('h2', null, title),
      EmptyState: () => null,
    };
    if (name.endsWith('/constants')) return {
      DAILY_GAME_LEVELS: 8, LEVEL_GAME_TYPES: ['true_false'], LEVEL_TIMERS: [60],
      GAME_QUESTIONS_PER_ROUND: 5, GAME_ROUNDS_PER_LEVEL: 3,
    };
    if (name.endsWith('/utils')) return { cn: (...values) => values.filter((value) => typeof value === 'string').join(' ') };
    if (name.endsWith('/supabase')) return { supabase: { rpc: () => { throw new Error('Render tests must not access production.'); } } };
    return emptyComponents;
  };
  vm.runInNewContext(outputText, { exports, require: mockedRequire, console }, { filename: relativePath });
  return exports;
}

journeyModule = loadComponent('src/components/InstructorJourneyReview.tsx');
const { InstructorApp } = loadComponent('src/screens/instructor/InstructorApp.tsx');
const journeyScreen = renderToStaticMarkup(React.createElement(InstructorApp));
assert.match(journeyScreen, /<nav>[\s\S]*Journey Questions[\s\S]*<\/nav>/);
assert.match(journeyScreen, /aria-expanded="true"[^>]*><span>Biblical Journey Questions<\/span>/,
  'Opening Journey Questions must reveal the bank without a second click.');

requestedTab = 'game_questions';
const gameQuestions = renderToStaticMarkup(React.createElement(InstructorApp));
assert.match(gameQuestions, /<button[^>]*>[\s\S]*Biblical Journey Questions[\s\S]*<\/button>/,
  'Game Questions must provide a visible Journey question-bank shortcut.');

const arenaBank = renderToStaticMarkup(React.createElement(journeyModule.InstructorJourneyReview));
assert.match(arenaBank, /aria-expanded="false"/,
  'The existing optional Arena panel should keep its collapsed state.');
console.log('Instructor navigation exposes the expanded Journey bank and a Game Questions shortcut.');
