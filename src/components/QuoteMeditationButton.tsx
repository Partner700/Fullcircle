import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, X } from 'lucide-react';
import type { DailyQuoteFeedItem, PanelImageSetting } from '../lib/types';
import { fetchPublicMeditationView } from '../lib/queries';
import { PanelImageBackdrop } from './PanelImageBackdrop';

export function QuoteMeditationButton({ quote, image }: { quote: DailyQuoteFeedItem; image?: PanelImageSetting | null }) {
  const [meditation, setMeditation] = useState<Awaited<ReturnType<typeof fetchPublicMeditationView>>>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPublicMeditationView(quote.user_id, quote.record_date)
      .then((value) => { if (!cancelled) setMeditation(value); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [quote.record_date, quote.user_id]);

  const modal = open && meditation ? (
    <div
      className="fixed inset-0 z-[2147483630] flex items-center justify-center bg-black/55 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`${quote.display_name}'s meditation`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <article className="card relative isolate max-h-[86vh] w-full max-w-xl overflow-hidden border-border shadow-2xl" onPointerDown={(event) => event.stopPropagation()}>
        <PanelImageBackdrop image={image || null} opacityFallback={100} veilClassName="" modeFilter={false} textGradient={false} />
        <div className="panel-veil-layer award-panel-veil pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative z-10 flex items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
          <div><p className="eyebrow text-stone">Public Meditation</p><h2 className="font-display text-lg font-semibold text-ink">{quote.display_name}</h2></div>
          <button type="button" className="btn-icon" onClick={() => setOpen(false)} aria-label="Close meditation"><X size={18} /></button>
        </div>
        <div className="relative z-10 max-h-[calc(86vh-5rem)] overflow-y-auto overscroll-contain px-5 pb-12 pt-5">
          {meditation.best_verse && <p className="text-xs font-bold text-brass">Best verse: {meditation.best_verse}</p>}
          <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-ink">{meditation.meditation_text}</p>
          {meditation.daily_quote && <p className="mt-5 border-l-2 border-brass/50 pl-3 font-display text-base italic text-stone">&ldquo;{meditation.daily_quote}&rdquo;</p>}
        </div>
      </article>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        disabled={loading || !meditation}
        className="ml-2 inline-flex align-baseline text-gold transition-colors hover:text-brass disabled:cursor-default disabled:text-stone-dim disabled:opacity-45"
        title={loading ? 'Checking meditation visibility' : meditation ? 'Read public meditation' : 'This meditation is private'}
        aria-label={meditation ? `Read ${quote.display_name}'s meditation` : `${quote.display_name}'s meditation is private`}
        onClick={() => { if (meditation) setOpen(true); }}
      >
        <Bookmark size={15} fill={meditation ? 'currentColor' : 'none'} />
      </button>
      {modal && createPortal(modal, document.body)}
    </>
  );
}
