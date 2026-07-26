const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'public', '.htaccess');
const target = path.join(root, 'dist', '.htaccess');

if (fs.existsSync(source) && fs.existsSync(path.dirname(target))) {
  fs.copyFileSync(source, target);
}
