const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const entries = [];
function scan(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) { scan(file); continue; }
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        const name = ts.isPropertyAccessExpression(expression) ? expression.name.text : ts.isIdentifier(expression) ? expression.text : '';
        const location = { file: path.relative(root, file), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 };
        if (name === 'select') entries.push({ ...location, kind: 'select', projection: node.arguments[0]?.getText(source) || '(default *)' });
        if (name === 'on' && node.arguments[0]?.getText(source).includes('postgres_changes')) {
          const options = node.arguments[1];
          const properties = options && ts.isObjectLiteralExpression(options) ? options.properties : [];
          const value = key => properties.find(property => property.name?.getText(source) === key)?.getText(source);
          entries.push({ ...location, kind: 'realtime', table: value('table'), event: value('event'), filtered: Boolean(value('filter')) });
        }
        if (name === 'setInterval') entries.push({ ...location, kind: 'interval', delay: node.arguments[1]?.getText(source) });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
scan(path.join(root, 'src'));
scan(path.join(root, 'supabase/functions'));
if (process.argv.includes('--json')) console.log(JSON.stringify(entries, null, 2));
else {
  const summary = {};
  for (const entry of entries) {
    const row = summary[entry.file] ||= { selects: 0, wildcardSelects: 0, realtime: 0, unfilteredRealtime: 0, intervals: 0 };
    if (entry.kind === 'select') { row.selects++; if (entry.projection === '(default *)' || /^['"]\*['"]$/.test(entry.projection)) row.wildcardSelects++; }
    if (entry.kind === 'realtime') { row.realtime++; if (!entry.filtered) row.unfilteredRealtime++; }
    if (entry.kind === 'interval') row.intervals++;
  }
  console.log(JSON.stringify(summary, null, 2));
  console.log('Inventory only: wildcard reads may need full records, intervals may be visual timers, and DELETE subscriptions cannot be server-filtered. Use --json for every location.');
}
