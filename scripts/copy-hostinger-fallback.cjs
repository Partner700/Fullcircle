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

// The stylesheet is the visual application shell. Some mobile networks have
// delivered index.html while dropping the immediately following CSS request,
// leaving users with a functional but completely unstyled sign-in form. Vite
// emits one CSS file because cssCodeSplit is disabled, so embedding that file
// removes the extra critical request without changing lazy application code.
const builtIndex = path.join(root, 'dist', 'index.html');
if (fs.existsSync(builtIndex)) {
  let html = fs.readFileSync(builtIndex, 'utf8');
  html = html.replace(
    /<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="(\.\/assets\/[^"]+\.css)")[^>]*>/g,
    (tag, relativeCssPath) => {
      const cssPath = path.join(root, 'dist', relativeCssPath.replace(/^\.\//, ''));
      if (!fs.existsSync(cssPath)) return tag;
      const css = fs.readFileSync(cssPath, 'utf8').replace(/<\/style/gi, '<\\/style');
      return `<style data-full-circle-release-styles="true">${css}</style>`;
    },
  );

  // Vite reconstructs the production module tag and drops attributes from the
  // source tag. Restore the mirror handler after the build so a failed entry or
  // dependency request can still load from the independent release copies.
  html = html.replace(
    /<script type="module" crossorigin src="(\.\/assets\/index-[^"]+\.js)"><\/script>/,
    '<script type="module" crossorigin src="$1" onerror="window.__loadFullCircleMirror(this.src)"></script>',
  );
  fs.writeFileSync(builtIndex, html);
}
