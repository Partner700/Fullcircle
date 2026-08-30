import type { PanelImageAdjustments, PanelImageSetting, ScheduledAnnouncement } from './types';

export const DEFAULT_PANEL_IMAGE_ADJUSTMENTS: PanelImageAdjustments = {
  brightness: 100,
  contrast: 100,
  blackPoint: 0,
  whitePoint: 100,
  black: 0,
  saturation: 100,
  vibrance: 0,
  hue: 0,
  temperature: 0,
  blur: 0,
  sharpness: 0,
  definition: 0,
  noise: 0,
  roughness: 0,
  depth: 0,
  vignette: 0,
  grain: 0,
  age: 0,
  opacity: 18,
};

function normalisePosition(value: number | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 50;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export function panelImageFromAnnouncement(
  announcement: Pick<ScheduledAnnouncement, 'content' | 'image_position_x' | 'image_position_y'>,
): PanelImageSetting {
  const parsed = parsePanelImageContent(announcement.content);
  return {
    url: parsed.url,
    positionX: normalisePosition(announcement.image_position_x),
    positionY: normalisePosition(announcement.image_position_y),
    adjustments: parsed.adjustments,
  };
}

export function panelImageObjectPosition(image: PanelImageSetting | null | undefined) {
  return image ? `${image.positionX}% ${image.positionY}%` : '50% 50%';
}

export function parsePanelImageContent(content: string | null | undefined): Pick<PanelImageSetting, 'url' | 'adjustments'> {
  const raw = String(content || '').trim();
  if (!raw) return { url: '', adjustments: DEFAULT_PANEL_IMAGE_ADJUSTMENTS };
  if (/^https?:\/\//i.test(raw)) {
    return { url: raw, adjustments: DEFAULT_PANEL_IMAGE_ADJUSTMENTS };
  }
  try {
    const parsed = JSON.parse(raw);
    const url = String(parsed?.url || '').trim();
    return {
      url,
      adjustments: normaliseAdjustments(parsed?.adjustments),
    };
  } catch {
    return { url: raw, adjustments: DEFAULT_PANEL_IMAGE_ADJUSTMENTS };
  }
}

export function serializePanelImageSetting(url: string, adjustments?: Partial<PanelImageAdjustments>) {
  return JSON.stringify({
    url,
    adjustments: normaliseAdjustments(adjustments),
  });
}

export function isPanelImageContent(content: string | null | undefined) {
  return /^https?:\/\//i.test(parsePanelImageContent(content).url);
}

export function normaliseAdjustments(input?: Partial<PanelImageAdjustments> | null): PanelImageAdjustments {
  const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
  };
  return {
    brightness: clamp(input?.brightness, 0, 200, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.brightness),
    contrast: clamp(input?.contrast, 0, 200, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.contrast),
    blackPoint: clamp(input?.blackPoint, 0, 100, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.blackPoint),
    whitePoint: clamp(input?.whitePoint, 0, 100, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.whitePoint),
    black: clamp(input?.black, 0, 100, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.black),
    saturation: clamp(input?.saturation, 0, 200, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.saturation),
    vibrance: clamp(input?.vibrance, -100, 100, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.vibrance),
    hue: clamp(input?.hue, -180, 180, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.hue),
    temperature: clamp(input?.temperature, -100, 100, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.temperature),
    blur: clamp(input?.blur, 0, 100, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.blur),
    sharpness: clamp(input?.sharpness, 0, 100, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.sharpness),
    definition: clamp(input?.definition, 0, 100, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.definition),
    noise: clamp(input?.noise, 0, 100, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.noise),
    roughness: clamp(input?.roughness, 0, 100, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.roughness),
    depth: clamp(input?.depth, 0, 100, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.depth),
    vignette: clamp(input?.vignette, 0, 100, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.vignette),
    grain: clamp(input?.grain, 0, 100, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.grain),
    age: clamp(input?.age, 0, 100, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.age),
    opacity: clamp(input?.opacity, 0, 100, DEFAULT_PANEL_IMAGE_ADJUSTMENTS.opacity),
  };
}

export function panelImageFilter(image: PanelImageSetting | null | undefined) {
  const a = normaliseAdjustments(image?.adjustments);
  const saturation = Math.max(0, a.saturation + Math.round(a.vibrance * 0.35) - Math.round(a.age * 0.35) - Math.round(a.roughness * 0.12));
  const sepia = Math.max(0, Math.min(100, a.age + Math.max(0, a.temperature) * 0.25));
  const brightness = Math.max(0, a.brightness + Math.round((a.whitePoint - 100) * 0.35) - Math.round(a.blackPoint * 0.15));
  const contrast = Math.max(0, a.contrast + Math.round(a.definition * 0.25) + Math.round(a.blackPoint * 0.2) + Math.round(a.roughness * 0.08));
  return [
    `brightness(${brightness}%)`,
    `contrast(${contrast}%)`,
    `saturate(${saturation}%)`,
    `hue-rotate(${a.hue + Math.round(a.temperature * 0.18)}deg)`,
    `sepia(${sepia}%)`,
    `blur(${(a.blur / 8).toFixed(2)}px)`,
  ].join(' ');
}

export function panelImageOpacity(image: PanelImageSetting | null | undefined, fallback = 18) {
  const opacity = image?.adjustments?.opacity ?? fallback;
  return Math.max(0, Math.min(100, opacity)) / 100;
}
