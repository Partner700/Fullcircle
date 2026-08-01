import { useCallback, useEffect, useState } from 'react';
import { Award as AwardIcon, Trophy } from 'lucide-react';
import { fetchAwards, fetchPanelImageSetting } from '../lib/queries';
import type { AwardWithRecipient, PanelImageSetting } from '../lib/types';
import { PanelImageBackdrop } from './PanelImageBackdrop';

type RecentAward = AwardWithRecipient;

export function RecentAwardsPanel({ onOpen }: { onOpen?: () => void }) {
  const [awards, setAwards] = useState<RecentAward[]>([]);
  const [image, setImage] = useState<PanelImageSetting | null>(null);

  const load = useCallback(async () => {
    const [awardResult, imageResult] = await Promise.allSettled([
      fetchAwards(),
      fetchPanelImageSetting('recent_awards'),
    ]);
    setAwards(awardResult.status === 'fulfilled' ? (awardResult.value.slice(0, 4) as RecentAward[]) : []);
    setImage(imageResult.status === 'fulfilled' ? imageResult.value : null);
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => { void load(); }, 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  return (
    <section className="card relative overflow-hidden border-gold/30 bg-surface-2">
      <PanelImageBackdrop image={image} opacityFallback={38} veilClassName="bg-surface/72" />
      <div className="relative flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2"><Trophy size={17} className="text-gold" /><div><h3 className="font-display text-sm font-semibold text-ink">Recent Awards</h3><p className="text-[11px] text-stone">Honors across Full Circle</p></div></div>
        {onOpen && <button type="button" onClick={onOpen} className="btn-ghost px-2 py-1 text-xs">View all</button>}
      </div>
      {awards.length ? (
        <div className="relative divide-y divide-border">
          {awards.map((award) => (
            <div key={award.id} className="flex items-center gap-3 px-4 py-3">
              <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-full border border-gold/40 bg-gold-soft text-center text-xs font-bold leading-9 text-gold">
                {(award.target_tent?.profile_image_url || award.profiles?.avatar_url)
                  ? <img src={award.target_tent?.profile_image_url || award.profiles?.avatar_url || ''} alt={award.target_tent?.name || award.profiles?.display_name || 'Award recipient'} className="h-full w-full object-cover" />
                  : <AwardIcon size={16} className="mx-auto mt-2.5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{award.title}</p>
                <p className="truncate text-xs font-medium text-stone">{award.target_tent?.name || award.profiles?.display_name || 'Full Circle member'}</p>
                {award.target_tent && <p className="truncate text-[11px] text-stone">Sentry: {award.target_tent.sentry?.display_name || 'Not assigned'}</p>}
              </div>
              <AwardIcon size={17} className="flex-shrink-0 text-gold" aria-hidden="true" />
            </div>
          ))}
        </div>
      ) : <p className="relative px-4 py-5 text-sm text-stone">New honors will appear here as they are awarded.</p>}
    </section>
  );
}
