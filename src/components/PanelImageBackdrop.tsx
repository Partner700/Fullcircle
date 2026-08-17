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
      <div className={cn('panel-image-backdrop pointer-events-none absolute inset-0 overflow-hidden', className)} aria-hidden="true">
        <img
          src={image.url}
          alt=""
          loading="eager"
          decoding="async"
          className={cn('panel-image-layer h-full w-full object-cover', imageClassName)}
          style={{ objectPosition: panelImageObjectPosition(image), opacity }}
        />
        {!!veilClassName.trim() && <div className={cn('panel-veil-layer absolute', veilClassName)} />}
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
  const effectBackgrounds: string[] = [];
  const effectSizes: string[] = [];
  if (whiteOverlayOpacity > 0) {
    effectBackgrounds.push(`linear-gradient(rgba(255,255,255,${whiteOverlayOpacity}), rgba(255,255,255,${whiteOverlayOpacity}))`);
    effectSizes.push('auto');
  }
  if (blackOverlayOpacity > 0) {
    effectBackgrounds.push(`linear-gradient(rgba(0,0,0,${blackOverlayOpacity}), rgba(0,0,0,${blackOverlayOpacity}))`);
    effectSizes.push('auto');
  }
  if (ageOpacity > 0) {
    effectBackgrounds.push(`linear-gradient(135deg, rgba(130,86,40,${0.65 * ageOpacity}), rgba(62,45,27,${0.28 * ageOpacity}) 48%, rgba(196,147,80,${0.42 * ageOpacity}))`);
    effectSizes.push('auto');
  }
  if (grainOpacity > 0) {
    effectBackgrounds.push(
      `radial-gradient(circle at 10% 20%, rgba(255,255,255,${0.35 * grainOpacity}) 0 1px, transparent 1px)`,
      `radial-gradient(circle at 80% 70%, rgba(0,0,0,${0.32 * grainOpacity}) 0 1px, transparent 1px)`,
    );
    effectSizes.push('9px 11px', '13px 15px');
  }
  if (vignetteOpacity > 0) {
    effectBackgrounds.push(`radial-gradient(circle at center, transparent 42%, rgba(0,0,0,${0.72 * vignetteOpacity}) 100%)`);
    effectSizes.push('auto');
  }
  if (textGradient) {
    effectBackgrounds.push('linear-gradient(90deg, rgba(7,18,38,0.42) 0%, rgba(7,18,38,0.3) 42%, rgba(7,18,38,0.12) 72%, transparent 100%)');
    effectSizes.push('auto');
  }

  return (
    <div className={cn('panel-image-backdrop pointer-events-none absolute inset-0 overflow-hidden', className)} aria-hidden="true">
      <img
        src={image.url}
        alt=""
        loading="eager"
        decoding="async"
        className={cn('panel-image-layer h-full w-full object-cover', imageClassName)}
        style={imageStyle}
      />
      {effectBackgrounds.length > 0 && (
        <div
          className="panel-effects-layer absolute"
          style={{
            backgroundImage: effectBackgrounds.join(', '),
            backgroundSize: effectSizes.join(', '),
          }}
        />
      )}
      {!!veilClassName.trim() && <div className={cn('panel-veil-layer absolute', veilClassName)} />}
    </div>
  );
}
