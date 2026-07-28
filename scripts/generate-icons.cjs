const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SVG_PATH = path.join(__dirname, '..', 'public', 'icons', 'fullcircle-icon.svg');
const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

async function generateIcons() {
  const svgBuffer = fs.readFileSync(SVG_PATH);

  for (const size of SIZES) {
    // Regular icon
    const regularPath = path.join(ICONS_DIR, `icon-${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
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
          input: await sharp(svgBuffer).resize(innerSize, innerSize).png().toBuffer(),
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
  await sharp(svgBuffer)
    .resize(180, 180)
    .png()
    .toFile(appleTouchPath);
  console.log('✓ Generated apple-touch-icon.png');
}

generateIcons().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});