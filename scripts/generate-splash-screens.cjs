const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ICON_PATH = path.join(__dirname, '..', 'public', 'icons', 'fullcircle-dove-clean.png');
const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');

const SPLASH_CONFIGS = [
  { name: 'apple-splash-640x1136.png', width: 640, height: 1136 },
  { name: 'apple-splash-750x1334.png', width: 750, height: 1334 },
  { name: 'apple-splash-828x1792.png', width: 828, height: 1792 },
  { name: 'apple-splash-1125x2436.png', width: 1125, height: 2436 },
  { name: 'apple-splash-1242x2688.png', width: 1242, height: 2688 },
  { name: 'apple-splash-1242x2208.png', width: 1242, height: 2208 },
  { name: 'apple-splash-2048x2732.png', width: 2048, height: 2732 },
  { name: 'apple-splash-1668x2388.png', width: 1668, height: 2388 },
  { name: 'apple-splash-1668x2224.png', width: 1668, height: 2224 },
  { name: 'apple-splash-1536x2048.png', width: 1536, height: 2048 },
];

async function generateSplashScreens() {
  // Logo size proportional to screen
  const iconBuffer = fs.readFileSync(ICON_PATH);

  for (const config of SPLASH_CONFIGS) {
    const logoSize = Math.round(Math.min(config.width, config.height) * 0.2);
    const logoX = Math.round((config.width - logoSize) / 2);
    const logoY = Math.round((config.height - logoSize) / 2);

    await sharp({
      create: {
        width: config.width,
        height: config.height,
        channels: 4,
        background: { r: 15, g: 32, b: 55, alpha: 1 }, // #0F2037
      },
    })
      .composite([
        {
          input: await sharp(iconBuffer).resize(logoSize, logoSize, { fit: 'contain' }).png().toBuffer(),
          top: logoY,
          left: logoX,
        },
      ])
      .png()
      .toFile(path.join(ICONS_DIR, config.name));
    console.log(`✓ Generated ${config.name} (${config.width}x${config.height})`);
  }
}

generateSplashScreens().catch((err) => {
  console.error('Splash screen generation failed:', err);
  process.exit(1);
});
