const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const snapshotDir = path.join(root, '.release-assets');

function copyFile(relativePath, fromRoot, toRoot) {
  const source = path.join(fromRoot, relativePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return;
  const target = path.join(toRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function snapshot() {
  fs.rmSync(snapshotDir, { recursive: true, force: true });
  const assets = path.join(dist, 'assets');
  if (!fs.existsSync(assets)) return;

  // Keep every already-deployed hashed asset, not only the files referenced by
  // the newest manifest. Older installed phones can still hold HTML from one of
  // the retained service-worker generations while an update is propagating.
  const pending = [assets];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const source = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(source);
        continue;
      }
      copyFile(path.relative(dist, source), dist, snapshotDir);
    }
  }
}

function restore() {
  if (!fs.existsSync(snapshotDir)) return;
  const pending = [snapshotDir];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const source = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(source);
        continue;
      }
      copyFile(path.relative(snapshotDir, source), snapshotDir, dist);
    }
  }
  fs.rmSync(snapshotDir, { recursive: true, force: true });
}

const action = process.argv[2];
if (action === 'snapshot') snapshot();
else if (action === 'restore') restore();
else throw new Error('Use "snapshot" or "restore".');
