const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif',
};
const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
};
type ImageUploadOptions = { maxDimension?: number; maxBytes?: number; quality?: number };

export function imageFileType(file: Pick<File, 'name' | 'type'>) {
  const supplied = file.type.toLowerCase();
  return supplied && supplied !== 'application/octet-stream'
    ? supplied
    : IMAGE_TYPES[file.name.split('.').pop()?.toLowerCase() || ''] || '';
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function decodeImage(file: File) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* Safari can decode some phone images through an img element instead. */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const timer = window.setTimeout(() => reject(new Error('Image decoding timed out.')), 20000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('Image decoding failed.')); };
      img.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(/image\/hei[cf]/.test(file.type)
      ? 'This phone cannot convert this HEIC photo. Choose a JPEG copy or take a new photo in Most Compatible format.'
      : 'This image could not be read. Choose another photo or a JPEG copy.');
  }
}

export async function prepareImageUpload(file: File, options: ImageUploadOptions = {}) {
  const maxDimension = options.maxDimension ?? 2200;
  const maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
  const quality = options.quality ?? 0.86;
  const type = imageFileType(file);
  if (!Object.values(IMAGE_TYPES).includes(type)) throw new Error('Choose a JPEG, PNG, WebP, AVIF, or supported HEIC photo.');
  if (file.size <= 0 || file.size > maxBytes) {
    throw new Error('Choose an image between 1 byte and ' + Math.round(maxBytes / 1024 / 1024) + ' MB.');
  }
  const typedFile = file.type === type ? file : new File([file], file.name, { type });
  const decoded = await decodeImage(typedFile);
  try {
    if (!decoded.width || !decoded.height) throw new Error('The photo has no readable image.');
    const scale = Math.min(1, maxDimension / Math.max(decoded.width, decoded.height));
    if (scale === 1 && file.size <= 900 * 1024 && IMAGE_EXTENSIONS[type]) {
      return { file: typedFile, extension: IMAGE_EXTENSIONS[type] };
    }
    const canvas = document.createElement('canvas');
    let width = Math.max(1, Math.round(decoded.width * scale));
    let height = Math.max(1, Math.round(decoded.height * scale));
    for (let attempt = 0; attempt < 4; attempt++) {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) throw new Error('Image processing is unavailable. Try a smaller JPEG photo.');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(decoded.source, 0, 0, width, height);
      const blob = await canvasBlob(canvas, 'image/webp', Math.max(0.55, quality - attempt * 0.1));
      // Browsers can fall back to PNG when WebP encoding is unavailable.
      const extension = blob && IMAGE_EXTENSIONS[blob.type];
      if (blob && extension && blob.size > 0 && blob.size <= 4.5 * 1024 * 1024) {
        return { file: new File([blob], (file.name.replace(/\.[^.]+$/, '') || 'image') + '.' + extension, { type: blob.type }), extension };
      }
      width = Math.max(1, Math.round(width * 0.75));
      height = Math.max(1, Math.round(height * 0.75));
    }
    throw new Error('The photo could not be reduced for upload. Choose a smaller JPEG copy.');
  } finally { decoded.close(); }
}
