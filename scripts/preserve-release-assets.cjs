const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const manifestPath = path.join(dist, '.vite', 'manifest.json');
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
  if (!fs.existsSync(manifestPath)) return;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const releaseFiles = new Set();
  for (const entry of Object.values(manifest)) {
    if (entry.file) releaseFiles.add(entry.file);
    for (const file of entry.css || []) releaseFiles.add(file);
    for (const file of entry.assets || []) releaseFiles.add(file);
  }

  for (const file of releaseFiles) copyFile(file, dist, snapshotDir);
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
