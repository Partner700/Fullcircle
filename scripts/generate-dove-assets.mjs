import sharp from '/Users/bameelhakol/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/lib/index.js';

const source = '/Users/bameelhakol/Downloads/WhatsApp Image 2026-07-26 at 08.40.34.jpeg';
const output = new URL('../public/icons/fullcircle-dove-clean.png', import.meta.url).pathname;

// The supplied portrait includes large empty margins. Work from the dove and
// cloud area only, which also excludes the two decorative guide bars.
const { data, info } = await sharp(source)
  .extract({ left: 140, top: 390, width: 650, height: 520 })
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const background = [0, 0, 0];
const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
for (const [x, y] of corners) {
  const offset = (y * width + x) * channels;
  background[0] += data[offset];
  background[1] += data[offset + 1];
  background[2] += data[offset + 2];
}
background.forEach((_, index) => { background[index] /= corners.length; });

const alpha = new Uint8Array(width * height).fill(255);
const seen = new Uint8Array(width * height);
const queue = [];
const isBackground = (index) => {
  const offset = index * channels;
  const distance = Math.hypot(
    data[offset] - background[0],
    data[offset + 1] - background[1],
    data[offset + 2] - background[2],
  );
  return distance < 46;
};
for (let x = 0; x < width; x += 1) queue.push(x, (height - 1) * width + x);
for (let y = 1; y < height - 1; y += 1) queue.push(y * width, y * width + width - 1);
for (let cursor = 0; cursor < queue.length; cursor += 1) {
  const index = queue[cursor];
  if (seen[index] || !isBackground(index)) continue;
  seen[index] = 1;
  alpha[index] = 0;
  const x = index % width;
  const y = Math.floor(index / width);
  if (x > 0) queue.push(index - 1);
  if (x < width - 1) queue.push(index + 1);
  if (y > 0) queue.push(index - width);
  if (y < height - 1) queue.push(index + width);
}

// The supplied JPEG contains two decorative black guide bars above and below
// the dove. They are separate from the background, so remove only rows that
// are overwhelmingly made up of dark foreground pixels before cropping.
for (let y = 0; y < height; y += 1) {
  let darkForegroundPixels = 0;
  for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    const offset = index * channels;
    if (alpha[index] && data[offset] < 120 && data[offset + 1] < 120 && data[offset + 2] < 120) {
      darkForegroundPixels += 1;
    }
  }
  if (darkForegroundPixels > width * 0.45) {
    for (let x = 0; x < width; x += 1) alpha[y * width + x] = 0;
  }
}

let left = width; let right = 0; let top = height; let bottom = 0;
for (let index = 0; index < alpha.length; index += 1) {
  if (!alpha[index]) continue;
  const x = index % width;
  const y = Math.floor(index / width);
  left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
}
const padding = 26;
left = Math.max(0, left - padding); top = Math.max(0, top - padding);
right = Math.min(width - 1, right + padding); bottom = Math.min(height - 1, bottom + padding);

const rgba = Buffer.alloc(width * height * 4);
for (let index = 0; index < width * height; index += 1) {
  const sourceOffset = index * channels;
  const targetOffset = index * 4;
  rgba[targetOffset] = data[sourceOffset];
  rgba[targetOffset + 1] = data[sourceOffset + 1];
  rgba[targetOffset + 2] = data[sourceOffset + 2];
  rgba[targetOffset + 3] = alpha[index];
}
const crop = { left, top, width: right - left + 1, height: bottom - top + 1 };
const dove = await sharp(rgba, { raw: { width, height, channels: 4 } }).extract(crop).resize(820, 820, { fit: 'contain' }).png().toBuffer();
const canvas = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: dove, gravity: 'centre' }])
  .raw()
  .toBuffer();

// Keep the portrait margins transparent. This strips any remaining export
// guides without affecting the dove, cloud, wing, or feet.
for (let y = 0; y < 1024; y += 1) {
  if (y >= 150 && y <= 865) continue;
  for (let x = 0; x < 1024; x += 1) canvas[(y * 1024 + x) * 4 + 3] = 0;
}

await sharp(canvas, { raw: { width: 1024, height: 1024, channels: 4 } })
  .png()
  .toFile(output);
