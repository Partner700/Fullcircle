import { useCallback, useEffect, useState } from 'react';
import { fetchGameActivityPlayers } from '../lib/queries';
import type { GameActivityPlayer } from '../lib/types';
import { getTodayISODate } from '../lib/utils';
import { startVisiblePolling } from '../lib/visiblePolling';

const REFRESH_INTERVAL_MS = 60_000;

export function useGameActivityPlayers(date = getTodayISODate()) {
  const [players, setPlayers] = useState<GameActivityPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => fetchGameActivityPlayers(date), [date]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (!active) return;
      try {
        const nextPlayers = await load();
        if (active) setPlayers(nextPlayers);
      } catch (error) {
        console.warn('Game activity profiles could not load:', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    const polling = startVisiblePolling(refresh, REFRESH_INTERVAL_MS);
    window.addEventListener('full-circle:game-activity', refresh);
    return () => {
      active = false;
      polling.stop();
      window.removeEventListener('full-circle:game-activity', refresh);
    };
  }, [load]);

  return { players, loading };
}
