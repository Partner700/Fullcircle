export const APP_DISPLAY_MODES = ['standalone', 'minimal-ui', 'window-controls-overlay', 'fullscreen'] as const;

export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    || APP_DISPLAY_MODES.some((mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches)
    || (typeof document !== 'undefined' && document.referrer.startsWith('android-app://'));
}
