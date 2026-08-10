
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const repo = '/Users/bameelhakol/Documents/GitHub/Fullcircle';
const source = '/Users/bameelhakol/Downloads/WhatsApp Image 2026-07-27 at 21.52.13.jpeg';

const iconSizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];
const splashSizes = [
  ['apple-splash-640x1136.png', 640, 1136],
  ['apple-splash-750x1334.png', 750, 1334],
  ['apple-splash-828x1792.png', 828, 1792],
  ['apple-splash-1125x2436.png', 1125, 2436],
  ['apple-splash-1242x2688.png', 1242, 2688],
  ['apple-splash-1242x2208.png', 1242, 2208],
  ['apple-splash-2048x2732.png', 2048, 2732],
  ['apple-splash-1668x2388.png', 1668, 2388],
  ['apple-splash-1668x2224.png', 1668, 2224],
  ['apple-splash-1536x2048.png', 1536, 2048],
];

function file(p) {
  return path.join(repo, p);
}

function read(p) {
  return fs.readFileSync(file(p), 'utf8');
}

function write(p, text) {
  fs.writeFileSync(file(p), text);
}

function removeIfExists(p) {
  const full = file(p);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

function updateHtml(p) {
  if (!fs.existsSync(file(p))) return;
  let html = read(p);
  html = html.replace(/\s*<link rel="icon" type="image\/svg\+xml" href="\/icons\/fullcircle-icon\.svg" \/>\n/g, '\n');
  html = html.replace(/<meta property="og:image" content="[^"]*" \/>/g, '<meta property="og:image" content="/fullcircle-share.jpeg" />');
  html = html.replace(/<meta property="og:image:width" content="[^"]*" \/>/g, '<meta property="og:image:width" content="1280" />');
  html = html.replace(/<meta property="og:image:height" content="[^"]*" \/>/g, '<meta property="og:image:height" content="960" />');
  html = html.replace(/<meta name="twitter:image" content="[^"]*" \/>/g, '<meta name="twitter:image" content="/fullcircle-share.jpeg" />');
  write(p, html);
}

function updateSw(p) {
  if (!fs.existsSync(file(p))) return;
  let sw = read(p);
  sw = sw.replace(/const CACHE_VERSION = 'full-circle-v\d+';/, "const CACHE_VERSION = 'full-circle-v4';");
  sw = sw.replace(/\s*'\/icons\/fullcircle-icon\.svg',\n/g, '\n');
  if (!sw.includes("'full-circle-v2-app'")) {
    sw = sw.replace(
      "  'full-circle-v1-fonts',\n];",
      "  'full-circle-v1-fonts',\n  'full-circle-v2-app',\n  'full-circle-v2-runtime',\n  'full-circle-v2-static',\n  'full-circle-v2-fonts',\n  'full-circle-v2-images',\n  'full-circle-v3-app',\n  'full-circle-v3-runtime',\n  'full-circle-v3-static',\n  'full-circle-v3-fonts',\n  'full-circle-v3-images',\n];"
    );
  }
  write(p, sw);
}

async function generateIcons(root) {
  const iconsDir = file(path.join(root, 'icons'));
  fs.mkdirSync(iconsDir, { recursive: true });

  for (const size of iconSizes) {
    const iconName = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
    await sharp(source)
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .png()
      .toFile(path.join(iconsDir, iconName));

    if (size !== 180) {
      await sharp(source)
        .resize(size, size, { fit: 'cover', position: 'centre' })
        .png()
        .toFile(path.join(iconsDir, `maskable-${size}.png`));
    }
  }

  for (const [name, width, height] of splashSizes) {
    await sharp(source)
      .resize(width, height, { fit: 'cover', position: 'centre' })
      .png()
      .toFile(path.join(iconsDir, name));
  }
}

async function main() {
  if (!fs.existsSync(repo)) throw new Error(`Repo not found: ${repo}`);
  if (!fs.existsSync(source)) throw new Error(`Latest image not found: ${source}`);

  removeIfExists('public/icons/fullcircle-icon.svg');
  removeIfExists('dist/icons/fullcircle-icon.svg');

  await sharp(source)
    .resize(1280, 960, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 92 })
    .toFile(file('public/fullcircle-share.jpeg'));

  if (fs.existsSync(file('dist'))) {
    await sharp(source)
      .resize(1280, 960, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 92 })
      .toFile(file('dist/fullcircle-share.jpeg'));
  }

  await generateIcons('public');
  if (fs.existsSync(file('dist'))) await generateIcons('dist');

  updateHtml('index.html');
  updateHtml('dist/index.html');
  updateSw('public/sw.js');
  updateSw('dist/sw.js');

  console.log('Updated all app icons and link-preview images from the latest Full Circle image.');
  console.log('Removed old SVG icon references so the old picture cannot be preferred by browsers.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
