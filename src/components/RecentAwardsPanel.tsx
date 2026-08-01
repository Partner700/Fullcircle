import { useCallback, useEffect, useState } from 'react';
import { Award as AwardIcon, Trophy } from 'lucide-react';
import { fetchAwards } from '../lib/queries';
import type { Award } from '../lib/types';

type RecentAward = Award & { profiles?: { display_name?: string } | null };

export function RecentAwardsPanel({ onOpen }: { onOpen?: () => void }) {
  const [awards, setAwards] = useState<RecentAward[]>([]);

  const load = useCallback(async () => {
    try { setAwards((await fetchAwards()).slice(0, 4) as RecentAward[]); } catch { setAwards([]); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="card overflow-hidden border-gold/30 bg-surface-2">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2"><Trophy size={17} className="text-gold" /><div><h3 className="font-display text-sm font-semibold text-ink">Recent Awards</h3><p className="text-[11px] text-stone">Honors across Full Circle</p></div></div>
        {onOpen && <button type="button" onClick={onOpen} className="btn-ghost px-2 py-1 text-xs">View all</button>}
      </div>
      {awards.length ? (
        <div className="divide-y divide-border">
          {awards.map((award) => (
            <div key={award.id} className="flex items-center gap-3 px-4 py-3">
              <AwardIcon size={16} className="flex-shrink-0 text-gold" />
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{award.title}</p><p className="truncate text-xs text-stone">{award.profiles?.display_name || 'Full Circle member'}</p></div>
            </div>
          ))}
        </div>
      ) : <p className="px-4 py-5 text-sm text-stone">New honors will appear here as they are awarded.</p>}
    </section>
  );
}
