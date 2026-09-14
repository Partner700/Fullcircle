const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'full-circle-pages-retention-'));
const previous = path.join(fixture, 'previous');
const next = path.join(fixture, 'next');

try {
  fs.mkdirSync(path.join(previous, '.vite'), { recursive: true });
  fs.mkdirSync(path.join(previous, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(next, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(previous, '.vite', 'manifest.json'), JSON.stringify({
    'index.html': {
      file: 'assets/index-old.js',
      css: ['assets/style-old.css'],
      assets: ['assets/dove-old.png'],
    },
    'src/CadetApp.tsx': { file: 'assets/cadet-old.js' },
  }));
  for (const file of ['index-old.js', 'style-old.css', 'dove-old.png', 'cadet-old.js', 'orphan.js']) {
    fs.writeFileSync(path.join(previous, 'assets', file), `previous:${file}`);
  }
  fs.writeFileSync(path.join(next, 'assets', 'index-old.js'), 'current-copy-wins');

  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'retain-previous-pages-assets.cjs'),
    previous,
    next,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(next, 'assets', 'index-old.js'), 'utf8'), 'current-copy-wins');
  assert.equal(fs.readFileSync(path.join(next, 'assets', 'style-old.css'), 'utf8'), 'previous:style-old.css');
  assert.equal(fs.readFileSync(path.join(next, 'assets', 'dove-old.png'), 'utf8'), 'previous:dove-old.png');
  assert.equal(fs.readFileSync(path.join(next, 'assets', 'cadet-old.js'), 'utf8'), 'previous:cadet-old.js');
  assert.equal(fs.existsSync(path.join(next, 'assets', 'orphan.js')), false);
  console.log('Pages release asset-retention checks passed.');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
