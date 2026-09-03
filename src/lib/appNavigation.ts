export const APP_NAVIGATION_EVENT = 'full-circle:navigate';

export type AppNavigationDetail = {
  actionKey: string;
  metadata?: Record<string, unknown>;
};

export function requestAppNavigation(actionKey: string, metadata?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !actionKey) return;

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  hash.set('fc-tab', actionKey);
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${hash.toString()}`);
  window.dispatchEvent(new CustomEvent<AppNavigationDetail>(APP_NAVIGATION_EVENT, {
    detail: { actionKey, metadata },
  }));
}
