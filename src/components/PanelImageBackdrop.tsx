import type { PanelImageSetting } from '../lib/types';
import { cn } from '../lib/utils';
import { normaliseAdjustments, panelImageFilter, panelImageObjectPosition, panelImageOpacity } from '../lib/panelImages';

interface PanelImageBackdropProps {
  image: PanelImageSetting | null | undefined;
  className?: string;
  imageClassName?: string;
  veilClassName?: string;
  opacityFallback?: number;
  opacityOverride?: number;
  modeFilter?: boolean;
  textGradient?: boolean;
  simple?: boolean;
}

export function PanelImageBackdrop({
  image,
  className,
  imageClassName,
  veilClassName = 'bg-surface/78',
  opacityFallback = 18,
  opacityOverride,
  modeFilter = true,
  textGradient = true,
  simple = false,
}: PanelImageBackdropProps) {
  if (!image?.url) return null;
  const adjustments = normaliseAdjustments(image.adjustments);
  const opacity = opacityOverride === undefined ? panelImageOpacity(image, opacityFallback) : opacityOverride / 100;

  if (simple) {
    return (
      <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)} aria-hidden="true">
        <img
          src={image.url}
          alt=""
          loading="eager"
          decoding="async"
          className={cn('h-full w-full object-cover', imageClassName)}
          style={{ objectPosition: panelImageObjectPosition(image), opacity }}
        />
        <div className={cn('absolute inset-0', veilClassName)} />
      </div>
    );
  }
  const shadow = adjustments.depth > 0
    ? `drop-shadow(0 ${Math.round(adjustments.depth / 7)}px ${Math.round(adjustments.depth / 2)}px rgba(0,0,0,${Math.min(0.55, adjustments.depth / 140)}))`
    : '';
  const definition = adjustments.definition + adjustments.sharpness;
  const imageStyle = {
    objectPosition: panelImageObjectPosition(image),
    opacity,
    filter: `${panelImageFilter(image)} ${modeFilter ? 'var(--panel-image-mode-filter)' : ''} ${shadow}`.trim(),
    transform: definition > 0 ? `scale(${1 + definition / 1600})` : undefined,
  };
  const whiteOverlayOpacity = Math.max(0, 100 - adjustments.whitePoint) / 160;
  const blackOverlayOpacity = (adjustments.black + adjustments.blackPoint) / 165;
  const grainOpacity = (adjustments.grain + adjustments.noise) / 220;
  const ageOpacity = adjustments.age / 160;
  const vignetteOpacity = adjustments.vignette / 100;

  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)} aria-hidden="true">
      <img
        src={image.url}
        alt=""
        loading="eager"
        decoding="async"
        className={cn('h-full w-full object-cover', imageClassName)}
        style={imageStyle}
      />
      {whiteOverlayOpacity > 0 && <div className="absolute inset-0 bg-white" style={{ opacity: whiteOverlayOpacity }} />}
      {blackOverlayOpacity > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: blackOverlayOpacity }} />}
      {ageOpacity > 0 && (
        <div
          className="absolute inset-0"
          style={{
            opacity: ageOpacity,
            background: 'linear-gradient(135deg, rgba(130,86,40,0.65), rgba(62,45,27,0.28) 48%, rgba(196,147,80,0.42))',
            mixBlendMode: 'multiply',
          }}
        />
      )}
      {grainOpacity > 0 && (
        <div
          className="absolute inset-0"
          style={{
            opacity: grainOpacity,
            backgroundImage: 'radial-gradient(circle at 10% 20%, rgba(255,255,255,0.35) 0 1px, transparent 1px), radial-gradient(circle at 80% 70%, rgba(0,0,0,0.32) 0 1px, transparent 1px)',
            backgroundSize: '9px 11px, 13px 15px',
            mixBlendMode: 'overlay',
          }}
        />
      )}
      {vignetteOpacity > 0 && (
        <div
          className="absolute inset-0"
          style={{
            opacity: vignetteOpacity,
            background: 'radial-gradient(circle at center, transparent 42%, rgba(0,0,0,0.72) 100%)',
          }}
        />
      )}
      {textGradient && (
        <div
          className="absolute inset-y-0 left-0 w-[78%]"
          style={{
            background: 'linear-gradient(90deg, color-mix(in srgb, var(--color-navy-2) 58%, transparent) 0%, color-mix(in srgb, var(--color-navy-2) 46%, transparent) 34%, color-mix(in srgb, var(--color-navy-2) 25%, transparent) 64%, color-mix(in srgb, var(--color-navy-2) 8%, transparent) 86%, transparent 100%)',
          }}
        />
      )}
      <div className={cn('absolute inset-0', veilClassName)} />
    </div>
  );
}
