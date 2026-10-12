import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Dices, Loader2, RotateCw, Swords } from 'lucide-react';
import { TentHouseSymbol } from './TentHouseSymbol';
import { fetchArenaFinalScorecard, type ArenaFinalScorecard as ScorecardData } from '../lib/queries';
import { groupArenaScoreTeams } from '../lib/arenaScorecard';

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

  const teams = result ? groupArenaScoreTeams(result.players) : [];
  const twoTeams = teams.length === 2;

  return <section className="mx-auto w-full max-w-3xl" aria-label="Final Arena score">
    <div className="overflow-hidden rounded-md border border-brass/45 bg-navy-2 px-4 py-5 text-white shadow-xl sm:px-7 sm:py-7">
      <div className="text-center">
        <p className="text-[10px] font-bold uppercase text-gold">Full Circle Arena</p>
        <h2 className="mt-1 font-display text-lg font-bold text-white sm:text-xl">{result?.room_name.replace(/\s*\[.*?\]/g, '') || 'Final score'}</h2>
        <p className="mt-1 text-xs font-bold uppercase text-white/65">Final / Correct answers</p>
      </div>
      {result ? <div className={twoTeams
        ? 'mt-6 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 sm:gap-5'
        : 'mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4'}>
        {teams.map((team, index) => <div key={team.key} className="min-w-0 text-center">
          <div className="flex h-10 items-center justify-center">
            {team.houseId ? <TentHouseSymbol houseId={team.houseId} size={38} />
              : team.name === 'The Scribe' ? <Dices size={27} className="text-gold" />
                : <Swords size={27} className="text-peri" />}
          </div>
          <p className="mt-2 min-h-8 text-xs font-bold leading-tight text-white sm:text-sm">{team.name}</p>
          <p className="mt-1 font-display text-4xl font-black tabular-nums text-white sm:text-6xl" aria-label={`${team.total} correct answers`}>{team.total}</p>
          <div className="mt-3 space-y-1 border-t border-white/20 pt-3 text-left">
            {team.players.map((player) => <div key={player.user_id} className="flex min-w-0 items-start justify-between gap-1 text-[11px] leading-snug sm:text-xs">
              <span className="min-w-0 break-words text-white/85">{player.display_name}</span>
              <span className="shrink-0 font-bold tabular-nums text-gold">{Math.max(0, Number(player.correct_count) || 0)}</span>
            </div>)}
          </div>
          {twoTeams && index === 0 && <span className="sr-only">versus</span>}
        </div>).reduce<ReactNode[]>((nodes, node, index) => {
          if (twoTeams && index === 1) nodes.push(<span key="versus" className="mt-16 font-display text-xl text-white/50" aria-hidden="true">-</span>);
          nodes.push(node);
          return nodes;
        }, [])}
      </div> : <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center text-sm text-white/75">
        {error ? <><p>{error}</p><button type="button" className="btn-secondary text-xs" onClick={() => { setError(null); setRetryKey((value) => value + 1); }}><RotateCw size={14} /> Try again</button></>
          : <><Loader2 size={18} className="animate-spin text-gold" /><p>Waiting for the match result...</p></>}
      </div>}
    </div>
    {onExit && <button type="button" onClick={onExit} className="btn-primary mt-4 w-full"><ArrowLeft size={16} /> Back to Arena</button>}
  </section>;
}
