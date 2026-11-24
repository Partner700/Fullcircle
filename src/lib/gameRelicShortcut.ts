let activeShortcuts = 0;
const listeners = new Set<() => void>();

export function gameRelicShortcutIsActive() {
  return activeShortcuts > 0;
}

export function subscribeToGameRelicShortcut(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function registerGameRelicShortcut() {
  activeShortcuts += 1;
  listeners.forEach(listener => listener());
  return () => {
    activeShortcuts -= 1;
    listeners.forEach(listener => listener());
  };
}
