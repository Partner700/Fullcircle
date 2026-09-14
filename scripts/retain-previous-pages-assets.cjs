const fs = require('node:fs');
const path = require('node:path');

const [previousRoot, nextRoot] = process.argv.slice(2);

if (!previousRoot || !nextRoot) {
  throw new Error('Usage: node retain-previous-pages-assets.cjs <previous-pages-root> <next-pages-root>');
}

const manifestPath = path.join(previousRoot, '.vite', 'manifest.json');
if (!fs.existsSync(manifestPath)) process.exit(0);

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const retained = new Set();

for (const entry of Object.values(manifest)) {
  if (!entry || typeof entry !== 'object') continue;
  for (const candidate of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
    if (typeof candidate === 'string' && candidate.startsWith('assets/')) retained.add(candidate);
  }
}

for (const relativePath of retained) {
  const source = path.join(previousRoot, relativePath);
  const destination = path.join(nextRoot, relativePath);
  if (!fs.existsSync(source) || fs.existsSync(destination)) continue;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

process.stdout.write(`Retained ${retained.size} previous-release asset references for cached phones.\n`);
