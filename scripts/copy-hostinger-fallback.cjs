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

// Keep index.html small enough to arrive atomically on weak mobile networks.
// The prior release embedded the full stylesheet in the document; a truncated
// response could therefore end inside <style> before the app shell existed.
// Publish the one Vite stylesheet at a stable, independently recoverable URL
// and append a marker that the bootstrap verifies before React may mount.
const builtIndex = path.join(root, 'dist', 'index.html');
if (fs.existsSync(builtIndex)) {
  let html = fs.readFileSync(builtIndex, 'utf8');
  html = html.replace(
    /<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="(\.\/assets\/[^"]+\.css)")[^>]*>/g,
    (tag, relativeCssPath) => {
      const cssPath = path.join(root, 'dist', relativeCssPath.replace(/^\.\//, ''));
      if (!fs.existsSync(cssPath)) return tag;
      const releaseCss = path.join(root, 'dist', 'full-circle-release.css');
      const css = `${fs.readFileSync(cssPath, 'utf8')}\n:root{--full-circle-release-style:"174"}\n`;
      fs.writeFileSync(releaseCss, css);
      return '<link rel="stylesheet" href="./full-circle-release.css?v=174" data-full-circle-release-styles="true" onload="window.__markFullCircleStylesReady(this)" onerror="window.__loadFullCircleStyleMirror(this)">';
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
