import { useEffect, useRef, useState } from 'react';
import { BookOpen, Eye, Lightbulb, ListFilter, Loader2, RotateCw, SkipForward, TimerReset, Volume2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { userFacingError } from '../lib/connectionErrors';
import { ARENA_RELICS, type ArenaQuestionAid, type ArenaRelicSlug } from '../../supabase/functions/_shared/arenaRelics';

const relics = [
  { slug: 'hint', name: 'Hint', Icon: Lightbulb },
  { slug: 'eliminate', name: 'Eliminate', Icon: ListFilter },
  { slug: 'freeze-timer', name: 'Freeze Timer', Icon: TimerReset },
  { slug: 'reveal-reference', name: 'Reveal Reference', Icon: BookOpen },
  { slug: 'talking-donkey', name: 'Talking Donkey', Icon: Volume2 },
  { slug: 'witch-ball-endor', name: 'Crystal Ball of Endor', Icon: Eye },
  { slug: 'skip', name: 'Skip', Icon: SkipForward },
] as const;

export function ArenaMarketRelics({ userId, questionType, aid, disabled, onUse }: {
  userId: string; questionType: string; aid?: ArenaQuestionAid; disabled: boolean;
  onUse: (slug: ArenaRelicSlug) => Promise<boolean>;
}) {
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [using, setUsing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    let active = true;
    void supabase.from('relic_inventory').select('quantity,relic_types!inner(slug)')
      .eq('user_id', userId).gt('quantity', 0).in('relic_types.slug', [...ARENA_RELICS])
      .then(({ data, error: failure }) => {
        if (!active) return;
        if (failure) { setError(userFacingError(failure, 'Your relics could not load. Try again.')); return; }
        const owned: Record<string, number> = {};
        for (const row of data || []) {
          const type = Array.isArray(row.relic_types) ? row.relic_types[0] : row.relic_types;
          if (type?.slug) owned[type.slug] = row.quantity;
        }
        setInventory(owned);
        setError(null);
      });
    return () => { active = false; };
  }, [userId, retry]);
  const use = async (slug: ArenaRelicSlug) => {
    if (busy.current || disabled) return;
    busy.current = true;
    setUsing(slug);
    try {
      if (await onUse(slug)) setInventory((owned) => ({ ...owned, [slug]: Math.max(0, (owned[slug] || 0) - 1) }));
      else setRetry((value) => value + 1);
    } catch (failure) {
      setError(userFacingError(failure, 'The relic could not be used. Try again.'));
    } finally { busy.current = false; setUsing(null); }
  };
  return <div className="mt-3 border-t border-border pt-3" aria-label="Owned Arena relics">
    <div className="flex flex-wrap gap-2">{relics.filter(({ slug }) => inventory[slug] > 0).map(({ slug, name, Icon }) =>
      <button key={slug} type="button" title={`${name} (${inventory[slug]})`} aria-label={`Use ${name} (${inventory[slug]} owned)`}
        disabled={disabled || !!using || aid?.used.includes(slug) || slug === 'eliminate' && !['multiple_choice', 'odd_one'].includes(questionType)}
        onClick={() => void use(slug)} className="icon-btn relative h-10 w-10 shrink-0 disabled:opacity-40">
        {using === slug ? <Loader2 size={18} className="animate-spin" /> : <Icon size={18} />}
        <span className="absolute -right-1 -top-1 rounded bg-surface-2 px-1 text-[9px] font-bold text-brass">{inventory[slug]}</span>
      </button>)}</div>
    {aid?.notice && <p className="mt-2 text-xs text-brass" role="status">{aid.notice}</p>}
    {error && <div className="mt-2 flex items-center gap-2 text-xs text-coral"><span>{error}</span><button type="button" className="icon-btn h-8 w-8 shrink-0" title="Retry relics" aria-label="Retry relics" onClick={() => setRetry((value) => value + 1)}><RotateCw size={14} /></button></div>}
  </div>;
}
