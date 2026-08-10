const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

type ImageUploadOptions = {
  maxDimension?: number;
  maxBytes?: number;
  quality?: number;
};

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function prepareImageUpload(file: File, options: ImageUploadOptions = {}) {
  const maxDimension = options.maxDimension ?? 2200;
  const maxBytes = options.maxBytes ?? 12 * 1024 * 1024;
  const quality = options.quality ?? 0.86;
  const sourceExtension = IMAGE_EXTENSIONS[file.type];

  if (!sourceExtension) {
    throw new Error('Choose a JPEG, PNG, WebP, or AVIF image.');
  }
  if (file.size <= 0 || file.size > maxBytes) {
    throw new Error(`Image files must be smaller than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    // Small, already efficient images do not need a lossy rewrite.
    if (scale === 1 && file.size <= 900 * 1024) {
      bitmap.close();
      return { file, extension: sourceExtension };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Image processing is unavailable.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await canvasBlob(canvas, 'image/webp', quality);
    if (!blob) throw new Error('The selected image could not be prepared.');
    return {
      file: new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'image'}.webp`, { type: 'image/webp' }),
      extension: 'webp',
    };
  } catch (error) {
    // Older Safari builds may not expose createImageBitmap. The validated
    // source remains usable and is still bounded by the size limit above.
    if (error instanceof Error && /processing|prepared/i.test(error.message)) throw error;
    return { file, extension: sourceExtension };
  }
}
