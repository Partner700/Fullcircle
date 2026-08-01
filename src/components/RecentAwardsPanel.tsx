import { useCallback, useEffect, useState } from 'react';
import { Award as AwardIcon, ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import { fetchAwards, fetchPanelImageSetting } from '../lib/queries';
import type { AwardWithRecipient, PanelImageSetting } from '../lib/types';
import { PanelImageBackdrop } from './PanelImageBackdrop';

type RecentAward = AwardWithRecipient;

export function RecentAwardsPanel({ onOpen }: { onOpen?: () => void }) {
  const [awards, setAwards] = useState<RecentAward[]>([]);
  const [image, setImage] = useState<PanelImageSetting | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

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

  useEffect(() => {
    if (awards.length <= 1) return;
    const interval = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % awards.length);
    }, 6000);
    return () => window.clearInterval(interval);
  }, [awards.length]);

  useEffect(() => {
    if (activeIndex >= awards.length) setActiveIndex(0);
  }, [activeIndex, awards.length]);

  const activeAward = awards[activeIndex];
  const move = (direction: number) => {
    if (!awards.length) return;
    setActiveIndex((index) => (index + direction + awards.length) % awards.length);
  };

  return (
    <section className="card relative overflow-hidden border-gold/30 bg-surface-2">
      <PanelImageBackdrop image={image} opacityFallback={38} veilClassName="bg-surface/72" />
      <div className="relative flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2"><Trophy size={17} className="text-gold" /><div><h3 className="font-display text-sm font-semibold text-ink">Recent Awards</h3><p className="text-[11px] text-stone">Honors across Full Circle</p></div></div>
        {onOpen && <button type="button" onClick={onOpen} className="btn-ghost px-2 py-1 text-xs">View all</button>}
      </div>
      {activeAward ? (
        <div className="relative min-h-[118px] overflow-hidden">
          <div className="flex transition-transform duration-700 ease-out" style={{ transform: `translateX(-${activeIndex * 100}%)` }}>
            {awards.map((award) => (
              <div key={award.id} className="flex min-w-full items-center gap-4 px-5 py-5">
                <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-full border-2 border-gold/50 bg-gold-soft text-gold shadow-sm">
                  {(award.target_tent?.profile_image_url || award.profiles?.avatar_url)
                    ? <img src={award.target_tent?.profile_image_url || award.profiles?.avatar_url || ''} alt={award.target_tent?.name || award.profiles?.display_name || 'Award recipient'} className="h-full w-full object-cover" />
                    : <Trophy size={24} className="mx-auto mt-3.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-ink">{award.title}</p>
                  <p className="text-sm font-medium text-stone">{award.target_tent?.name || award.profiles?.display_name || 'Full Circle member'}</p>
                  {award.target_tent && <p className="text-xs text-stone">Family trophy · Sentry: {award.target_tent.sentry?.display_name || 'Not assigned'}</p>}
                  {award.description && <p className="mt-1 line-clamp-2 text-xs text-stone">{award.description}</p>}
                </div>
                <AwardIcon size={22} className="flex-shrink-0 text-gold" aria-hidden="true" />
              </div>
            ))}
          </div>
          {awards.length > 1 && (
            <div className="absolute bottom-2 right-3 flex items-center gap-1">
              <button type="button" onClick={() => move(-1)} className="icon-btn h-7 w-7" aria-label="Previous award"><ChevronLeft size={14} /></button>
              <span className="min-w-8 text-center text-[10px] text-stone">{activeIndex + 1}/{awards.length}</span>
              <button type="button" onClick={() => move(1)} className="icon-btn h-7 w-7" aria-label="Next award"><ChevronRight size={14} /></button>
            </div>
          )}
        </div>
      ) : <p className="relative px-4 py-5 text-sm text-stone">New honors will appear here as they are awarded.</p>}
    </section>
  );
}
