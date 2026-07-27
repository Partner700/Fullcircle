import type { PanelImageSetting, ScheduledAnnouncement } from './types';

function normalisePosition(value: number | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 50;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export function panelImageFromAnnouncement(
  announcement: Pick<ScheduledAnnouncement, 'content' | 'image_position_x' | 'image_position_y'>,
): PanelImageSetting {
  return {
    url: announcement.content,
    positionX: normalisePosition(announcement.image_position_x),
    positionY: normalisePosition(announcement.image_position_y),
  };
}

export function panelImageObjectPosition(image: PanelImageSetting | null | undefined) {
  return image ? `${image.positionX}% ${image.positionY}%` : '50% 50%';
}
