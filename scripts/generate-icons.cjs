const sharp = require('/Users/bameelhakol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const fs = require('fs');
const path = require('path');

const SOURCE_PATH = path.join(__dirname, '..', 'public', 'icons', 'fullcircle-dove-clean.png');
const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

async function generateIcons() {
  const dove = fs.readFileSync(SOURCE_PATH);

  for (const size of SIZES) {
    // Regular icon
    const regularPath = path.join(ICONS_DIR, `icon-${size}.png`);
    await sharp({
      create: { width: size, height: size, channels: 4, background: { r: 15, g: 32, b: 55, alpha: 1 } },
    })
      .composite([{ input: await sharp(dove).resize(Math.round(size * 0.82), Math.round(size * 0.82), { fit: 'contain' }).png().toBuffer(), top: Math.round(size * 0.09), left: Math.round(size * 0.09) }])
      .png()
      .toFile(regularPath);
    console.log(`✓ Generated icon-${size}.png`);

    // Maskable icon (with padding for safe zone)
    const maskablePath = path.join(ICONS_DIR, `maskable-${size}.png`);
    // For maskable, we add a background and some padding
    const padding = Math.round(size * 0.1);
    const innerSize = size - padding * 2;
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 15, g: 32, b: 55, alpha: 1 }, // #0F2037
      },
    })
      .composite([
        {
          input: await sharp(dove).resize(innerSize, innerSize, { fit: 'contain' }).png().toBuffer(),
          top: padding,
          left: padding,
        },
      ])
      .png()
      .toFile(maskablePath);
    console.log(`✓ Generated maskable-${size}.png`);
  }

  // Apple touch icon (180x180)
  const appleTouchPath = path.join(ICONS_DIR, 'apple-touch-icon.png');
  await sharp({
    create: { width: 180, height: 180, channels: 4, background: { r: 15, g: 32, b: 55, alpha: 1 } },
  })
    .composite([{ input: await sharp(dove).resize(148, 148, { fit: 'contain' }).png().toBuffer(), top: 16, left: 16 }])
    .png()
    .toFile(appleTouchPath);
  console.log('✓ Generated apple-touch-icon.png');
}

generateIcons().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
