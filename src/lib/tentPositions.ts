import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type TentPosition = {
  user_id: string;
  overall_position: number;
  weekly_position: number;
};
export type TentOrder = 'overall' | 'weekly';

export function useTentPositions(tentId: string | undefined, memberCount: number) {
  const [order, setOrder] = useState<TentOrder>('overall');
  const [result, setResult] = useState<{ tentId: string; positions: TentPosition[] | null }>();

  useEffect(() => {
    if (!tentId || !memberCount) return;
    let active = true;
    const load = async () => {
      const { data, error } = await supabase.rpc('get_tent_cadet_positions', { p_tent_id: tentId });
      if (active) setResult({ tentId, positions: error ? null : data ?? [] });
    };
    void load();
    const refresh = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', refresh);
      window.clearInterval(timer);
    };
  }, [tentId, memberCount]);

  const positions = result?.tentId === tentId ? result?.positions : undefined;
  const byId = new Map(positions?.map(position => [position.user_id, position]));
  const field = order === 'overall' ? 'overall_position' : 'weekly_position';
  const compare = (a: { user_id: string }, b: { user_id: string }) =>
    (byId.get(a.user_id)?.[field] ?? Infinity) - (byId.get(b.user_id)?.[field] ?? Infinity);
  return { order, setOrder, byId, compare, unavailable: positions === null };
}
