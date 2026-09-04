import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, Crop, Loader2, RotateCcw, X, ZoomIn } from 'lucide-react';
import { uploadAvatar } from '../lib/queries';
import { cn } from '../lib/utils';
import type { Profile } from '../lib/types';
import { VallumAvatarBadge } from './VallumAvatarBadge';

type CropPoint = { x: number; y: number };

type CropImageSize = {
  width: number;
  height: number;
};

type AvatarCropDialogProps = {
  file: File;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (file: File) => Promise<void>;
  title?: string;
};

type ProfilePhotoEditorProps = {
  profile: Pick<Profile, 'id' | 'display_name' | 'avatar_url'> | null;
  onUploaded: () => void | Promise<void>;
  fallback?: ReactNode;
  size?: 'md' | 'lg';
};

function clampCropOffset(
  point: CropPoint,
  imageSize: CropImageSize,
  frameSize: number,
  zoom: number,
): CropPoint {
  if (!imageSize.width || !imageSize.height || !frameSize) return { x: 0, y: 0 };
  const scale = (frameSize / Math.min(imageSize.width, imageSize.height)) * zoom;
  const maxX = Math.max(0, (imageSize.width * scale - frameSize) / 2);
  const maxY = Math.max(0, (imageSize.height * scale - frameSize) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, point.x)),
    y: Math.max(-maxY, Math.min(maxY, point.y)),
  };
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

export function AvatarCropDialog({
  file,
  saving,
  onCancel,
  onConfirm,
  title = 'Crop profile photo',
}: AvatarCropDialogProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: CropPoint;
  } | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [imageSize, setImageSize] = useState<CropImageSize>({ width: 0, height: 0 });
  const [frameSize, setFrameSize] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<CropPoint>({ x: 0, y: 0 });
  const [preparing, setPreparing] = useState(false);
  const [imageError, setImageError] = useState('');

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setImageError('');
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const updateSize = () => setFrameSize(frame.getBoundingClientRect().width);
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [previewUrl]);

  useEffect(() => {
    setOffset((current) => {
      const next = clampCropOffset(current, imageSize, frameSize, zoom);
      return next.x === current.x && next.y === current.y ? current : next;
    });
  }, [frameSize, imageSize, zoom]);

  const displaySize = useMemo(() => {
    if (!imageSize.width || !imageSize.height || !frameSize) return { width: 0, height: 0, scale: 0 };
    const scale = (frameSize / Math.min(imageSize.width, imageSize.height)) * zoom;
    return {
      width: imageSize.width * scale,
      height: imageSize.height * scale,
      scale,
    };
  }, [frameSize, imageSize, zoom]);

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const createCroppedFile = async () => {
    const image = imageRef.current;
    if (!image || !displaySize.scale || !frameSize) throw new Error('The photo is still loading.');

    const imageLeft = frameSize / 2 + offset.x - displaySize.width / 2;
    const imageTop = frameSize / 2 + offset.y - displaySize.height / 2;
    const sourceSize = frameSize / displaySize.scale;
    const sourceX = Math.max(0, Math.min(image.naturalWidth - sourceSize, -imageLeft / displaySize.scale));
    const sourceY = Math.max(0, Math.min(image.naturalHeight - sourceSize, -imageTop / displaySize.scale));
    const outputSize = 768;
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo cropping is unavailable on this device.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      outputSize,
      outputSize,
    );
    const blob = await canvasBlob(canvas, 'image/webp', 0.9);
    if (!blob) throw new Error('The cropped photo could not be prepared.');
    const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'webp';
    return new File([blob], `profile-photo-${Date.now()}.${extension}`, { type: blob.type || 'image/webp' });
  };

  const confirmCrop = async () => {
    setPreparing(true);
    try {
      await onConfirm(await createCroppedFile());
    } catch (error) {
      alert(error instanceof Error ? error.message : 'The photo could not be saved.');
    } finally {
      setPreparing(false);
    }
  };

  const dialog = (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-ink/70 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="profile-photo-crop-title">
      <div className="w-full max-w-md overflow-y-auto rounded-lg border border-border-bright bg-surface p-4 shadow-2xl max-h-[94dvh] sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Crop size={18} className="shrink-0 text-brass" />
            <h2 id="profile-photo-crop-title" className="truncate font-display text-lg font-semibold text-ink">{title}</h2>
          </div>
          <button type="button" onClick={onCancel} disabled={saving || preparing} className="icon-button h-9 w-9" title="Close" aria-label="Close photo cropper">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 flex justify-center">
          <div
            ref={frameRef}
            className="relative aspect-square w-[min(76vw,19rem)] touch-none overflow-hidden rounded-full border-2 border-brass/70 bg-navy shadow-inner cursor-grab active:cursor-grabbing"
            onPointerDown={(event) => {
              if (!imageSize.width || saving || preparing) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                origin: offset,
              };
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              setOffset(clampCropOffset({
                x: drag.origin.x + event.clientX - drag.startX,
                y: drag.origin.y + event.clientY - drag.startY,
              }, imageSize, frameSize, zoom));
            }}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
          >
            {previewUrl && !imageError && (
              <img
                ref={imageRef}
                src={previewUrl}
                alt="Photo crop preview"
                draggable={false}
                onLoad={(event) => {
                  setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
                  setOffset({ x: 0, y: 0 });
                }}
                onError={() => setImageError('This photo cannot be opened on this device.')}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                style={{
                  width: `${displaySize.width}px`,
                  height: `${displaySize.height}px`,
                  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                }}
              />
            )}
            {!imageSize.width && !imageError && (
              <div className="absolute inset-0 flex items-center justify-center"><Loader2 size={24} className="animate-spin text-white" /></div>
            )}
            {imageError && <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm font-semibold text-white">{imageError}</div>}
            <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/40" />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
          <ZoomIn size={17} className="shrink-0 text-stone" />
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            disabled={!imageSize.width || saving || preparing}
            className="min-w-0 flex-1 accent-brass"
            aria-label="Profile photo zoom"
          />
          <button
            type="button"
            onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
            disabled={!imageSize.width || saving || preparing}
            className="icon-button h-8 w-8"
            title="Reset crop"
            aria-label="Reset crop"
          >
            <RotateCcw size={15} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button type="button" onClick={onCancel} disabled={saving || preparing} className="btn-secondary justify-center">Cancel</button>
          <button type="button" onClick={confirmCrop} disabled={!imageSize.width || !!imageError || saving || preparing} className="btn-primary justify-center">
            {saving || preparing ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Use photo
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

export function ProfilePhotoEditor({ profile, onUploaded, fallback, size = 'lg' }: ProfilePhotoEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(false);

  const closeCropper = () => {
    setCropFile(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const saveCroppedPhoto = async (file: File) => {
    if (!profile) return;
    setUploading(true);
    try {
      await uploadAvatar(profile.id, file);
      await onUploaded();
      closeCropper();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'The profile photo could not be uploaded.');
    } finally {
      setUploading(false);
    }
  };

  const editCurrentPhoto = async () => {
    if (!profile) return;
    if (!profile.avatar_url) {
      inputRef.current?.click();
      return;
    }

    setLoadingCurrent(true);
    try {
      const response = await fetch(profile.avatar_url, { cache: 'no-store' });
      if (!response.ok) throw new Error('The current profile photo could not be opened.');
      const blob = await response.blob();
      const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
      setCropFile(new File([blob], `current-profile-photo.${extension}`, {
        type: blob.type || 'image/jpeg',
      }));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'The current profile photo could not be opened.');
    } finally {
      setLoadingCurrent(false);
    }
  };

  return (
    <>
      <div className={cn(
        'relative shrink-0 overflow-visible rounded-full',
        size === 'md' ? 'h-16 w-16' : 'h-20 w-20',
      )}>
        <button
          type="button"
          onClick={editCurrentPhoto}
          disabled={!profile || uploading || loadingCurrent}
          className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border-2 border-border-bright bg-peri-soft shadow-sm transition-transform hover:scale-[1.02] disabled:opacity-70"
          title={profile?.avatar_url ? 'Adjust current profile photo' : 'Choose profile photo'}
          aria-label={profile?.avatar_url ? 'Adjust current profile photo' : 'Choose profile photo'}
        >
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt={profile.display_name} className="h-full w-full object-cover" />
          ) : (
            fallback || <span className="font-display text-2xl font-bold text-peri">{profile?.display_name?.charAt(0).toUpperCase() || '?'}</span>
          )}
          {loadingCurrent && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-ink/45 text-white">
              <Loader2 size={18} className="animate-spin" />
            </span>
          )}
        </button>
        {profile?.avatar_url && (
          <button
            type="button"
            onClick={editCurrentPhoto}
            disabled={uploading || loadingCurrent}
            className="absolute -bottom-1 -left-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface bg-brass text-navy shadow-md transition-transform hover:scale-105 disabled:opacity-60"
            title="Crop and adjust current photo"
            aria-label="Crop and adjust current profile photo"
          >
            {loadingCurrent ? <Loader2 size={15} className="animate-spin" /> : <Crop size={15} />}
          </button>
        )}
        <VallumAvatarBadge userId={profile?.id} size="md" />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!profile || uploading || loadingCurrent}
          className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface bg-peri text-white shadow-md transition-transform hover:scale-105 disabled:opacity-60"
          title="Change profile photo"
          aria-label="Change profile photo"
        >
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="hidden"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (!selected) return;
            if (selected.size > 12 * 1024 * 1024) {
              alert('Choose a profile photo smaller than 12 MB.');
              event.target.value = '';
              return;
            }
            setCropFile(selected);
          }}
        />
      </div>
      {cropFile && (
        <AvatarCropDialog
          file={cropFile}
          saving={uploading}
          onCancel={closeCropper}
          onConfirm={saveCroppedPhoto}
        />
      )}
    </>
  );
}
