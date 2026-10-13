import { useEffect, useState } from 'react';
import { ArrowLeft, Dices, Loader2, RotateCw, Swords } from 'lucide-react';
import { TentHouseSymbol } from './TentHouseSymbol';
import { fetchArenaFinalScorecard, type ArenaFinalScorecard as ScorecardData } from '../lib/queries';
import { shortestArenaName } from '../lib/arenaScorecard';

export function ArenaFinalScorecard({ roomId, onExit }: { roomId: string; onExit?: () => void }) {
  const [result, setResult] = useState<ScorecardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timeout: number | undefined;
    const load = async () => {
      try {
        const data = await fetchArenaFinalScorecard(roomId);
        if (cancelled) return;
        if (data) {
          setResult(data);
          setError(null);
          return;
        }
        setError(null);
      } catch {
        if (!cancelled) setError('The final score could not load.');
      }
      if (!cancelled) timeout = window.setTimeout(() => void load(), 8000);
    };
    void load();
    return () => { cancelled = true; if (timeout) window.clearTimeout(timeout); };
  }, [retryKey, roomId]);

  const players = result?.players || [];
  const compact = players.length > 2;
  const columns = players.length >= 4 ? 'grid-cols-4' : players.length === 3 ? 'grid-cols-3' : 'grid-cols-2';

  return <section className="mx-auto w-full max-w-3xl" aria-label="Final Arena score">
    <div className="overflow-hidden rounded-md border border-brass/45 bg-navy-2 px-4 py-5 text-white shadow-xl sm:px-7 sm:py-7">
      <div className="text-center">
        <p className="text-[10px] font-bold uppercase text-gold">Full Circle Arena</p>
        <h2 className="mt-1 font-display text-lg font-bold text-white sm:text-xl">{result?.room_name.replace(/\s*\[.*?\]/g, '') || 'Final score'}</h2>
        <p className="mt-1 text-xs font-bold uppercase text-white/65">Final / Correct answers</p>
      </div>
      {result ? <div className={`mt-6 grid ${columns} items-start gap-x-2 gap-y-6 sm:gap-x-5`}>
        {players.map((player) => <div key={player.user_id} className="min-w-0 text-center" title={player.display_name}>
          <div className="flex h-10 items-center justify-center" aria-label={player.tent_name || 'Independent'}>
            {player.tent_house_id ? <TentHouseSymbol houseId={player.tent_house_id} size={compact ? 29 : 38} />
              : player.display_name === 'The Scribe' ? <Dices size={compact ? 24 : 27} className="text-gold" />
                : <Swords size={compact ? 24 : 27} className="text-peri" />}
          </div>
          <p className={`mt-1 font-display font-black tabular-nums text-white ${compact ? 'text-3xl sm:text-4xl' : 'text-5xl sm:text-6xl'}`} aria-label={`${player.correct_count} correct answers`}>
            {Math.max(0, Number(player.correct_count) || 0)}
          </p>
          <p className={`mt-1 min-w-0 break-words font-bold leading-tight text-white/90 ${compact ? 'text-[10px] sm:text-xs' : 'text-xs sm:text-sm'}`}>
            {shortestArenaName(player.display_name)}
          </p>
        </div>)}
      </div> : <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center text-sm text-white/75">
        {error ? <><p>{error}</p><button type="button" className="btn-secondary text-xs" onClick={() => { setError(null); setRetryKey((value) => value + 1); }}><RotateCw size={14} /> Try again</button></>
          : <><Loader2 size={18} className="animate-spin text-gold" /><p>Waiting for the match result...</p></>}
      </div>}
    </div>
    {onExit && <button type="button" onClick={onExit} className="btn-primary mt-4 w-full"><ArrowLeft size={16} /> Back to Arena</button>}
  </section>;
}
