const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');

const SPLASH_FILES = [
  'apple-splash-640x1136.png',
  'apple-splash-750x1334.png',
  'apple-splash-828x1792.png',
  'apple-splash-1125x2436.png',
  'apple-splash-1242x2688.png',
  'apple-splash-1242x2208.png',
  'apple-splash-2048x2732.png',
  'apple-splash-1668x2388.png',
  'apple-splash-1668x2224.png',
  'apple-splash-1536x2048.png',
];

async function optimizeSplashScreens() {
  for (const filename of SPLASH_FILES) {
    const filepath = path.join(ICONS_DIR, filename);
    if (!fs.existsSync(filepath)) {
      console.log(`✗ Skipping ${filename} (not found)`);
      continue;
    }

    const inputBuffer = fs.readFileSync(filepath);
    const { size: originalSize } = fs.statSync(filepath);

    // Re-encode with optimized PNG settings
    const optimized = await sharp(inputBuffer)
      .png({
        compressionLevel: 9,
        palette: true,
        colors: 64,
        quality: 80,
      })
      .toBuffer();

    fs.writeFileSync(filepath, optimized);
    const savedBytes = originalSize - optimized.length;
    const savedPercent = ((savedBytes / originalSize) * 100).toFixed(1);
    console.log(`✓ Optimized ${filename} (${(originalSize / 1024).toFixed(1)}KB → ${(optimized.length / 1024).toFixed(1)}KB, saved ${savedPercent}%)`);
  }
}

optimizeSplashScreens().catch((err) => {
  console.error('Optimization failed:', err);
  process.exit(1);
});