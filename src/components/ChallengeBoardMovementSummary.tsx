import { ArrowDown, ArrowUp, Sparkles } from 'lucide-react';

export function ChallengeBoardMovementSummary({ rising, falling, records }: { rising: number; falling: number; records: number }) {
  return <div className="grid grid-cols-3 gap-2">
    <div className="rounded-lg border border-sage/25 bg-sage/10 px-3 py-2">
      <p className="flex items-center gap-1 text-[10px] font-black uppercase text-sage"><ArrowUp size={12} /> Rising</p>
      <p className="mt-1 font-display text-xl font-black text-ink">{rising}</p>
    </div>
    <div className="rounded-lg border border-coral/25 bg-coral/10 px-3 py-2">
      <p className="flex items-center gap-1 text-[10px] font-black uppercase text-coral"><ArrowDown size={12} /> Falling</p>
      <p className="mt-1 font-display text-xl font-black text-ink">{falling}</p>
    </div>
    <div className="rounded-lg border border-gold/25 bg-gold/10 px-3 py-2">
      <p className="flex items-center gap-1 text-[10px] font-black uppercase text-gold"><Sparkles size={12} /> Records</p>
      <p className="mt-1 font-display text-xl font-black text-ink">{records}</p>
    </div>
  </div>;
}
