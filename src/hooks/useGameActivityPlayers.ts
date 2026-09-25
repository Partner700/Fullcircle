import { useCallback, useEffect, useState } from 'react';
import { fetchGameActivityPlayers } from '../lib/queries';
import type { GameActivityPlayer } from '../lib/types';
import { getTodayISODate } from '../lib/utils';

const REFRESH_INTERVAL_MS = 20_000;

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

    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { players, loading };
}
