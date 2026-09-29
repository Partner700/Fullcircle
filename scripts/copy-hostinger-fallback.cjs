const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'public', '.htaccess');
const target = path.join(root, 'dist', '.htaccess');

if (fs.existsSync(source) && fs.existsSync(path.dirname(target))) {
  fs.copyFileSync(source, target);
}

// Hostinger blocks dot-directory URLs. The worker needs the manifest belonging
// to this exact build, not a differently compiled mirror's manifest.
const manifest = path.join(root, 'dist', '.vite', 'manifest.json');
if (fs.existsSync(manifest)) {
  fs.copyFileSync(manifest, path.join(root, 'dist', 'release-manifest.json'));
}
