import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarClock, Loader2, RotateCw, Search, Swords, Trophy } from 'lucide-react';
import { AppSelect } from './AppSelect';
import { UserAvatar } from './UserAvatar';
import {
  cancelInstructorArenaTournament, createInstructorArenaTournament, fetchArenaInvitees,
  fetchArenaTournaments, rescheduleArenaTournamentGame, scheduleInstructorArenaMatch,
  type ArenaTournament,
} from '../lib/queries';
import { arenaTournamentEntrants, arenaTournamentSlots, validateArenaTournamentTimes, type ArenaTournamentStart } from '../lib/arenaTournament';
import { shortestArenaName } from '../lib/arenaScorecard';
import type { Profile, RoleAssignment } from '../lib/types';

type Player = RoleAssignment & { profiles: Profile };
type Mode = 'match' | 'tournament';

export function InstructorArenaScheduler({ onScheduled }: { onScheduled: () => Promise<void> | void }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [tournaments, setTournaments] = useState<ArenaTournament[]>([]);
  const [roomName, setRoomName] = useState('');
  const [gameType, setGameType] = useState<'standard' | 'ludo'>('standard');
  const [mode, setMode] = useState<Mode>('match');
  const [startRound, setStartRound] = useState<ArenaTournamentStart>('quarterfinal');
  const [groupEntrants, setGroupEntrants] = useState<8 | 16 | 32>(8);
  const [startsAt, setStartsAt] = useState('');
  const [gameTimes, setGameTimes] = useState<string[]>(Array(7).fill(''));
  const [replayTimes, setReplayTimes] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const visible = useMemo(() => players.filter((player) =>
    player.profiles?.display_name?.toLowerCase().includes(search.trim().toLowerCase())), [players, search]);
  const entrantCount = arenaTournamentEntrants(startRound, groupEntrants);
  const hasGroups = startRound === 'groups';
  const capacity = mode === 'tournament' ? entrantCount : gameType === 'ludo' ? 4 : 8;
  const slots = arenaTournamentSlots(entrantCount, hasGroups);

  const refreshTournaments = useCallback(async () => {
    setTournaments(await fetchArenaTournaments());
  }, []);

  useEffect(() => {
    let active = true;
    void fetchArenaInvitees().then((items) => { if (active) setPlayers(items as Player[]); })
      .catch(() => { if (active) setMessage('The player list could not load.'); });
    void fetchArenaTournaments().then((items) => { if (active) setTournaments(items); })
      .catch(() => { if (active) setMessage('The tournament schedule could not load.'); });
    return () => { active = false; };
  }, []);

  const moveSelected = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= selected.length) return;
    setSelected((ids) => {
      const updated = [...ids];
      [updated[index], updated[target]] = [updated[target], updated[index]];
      return updated;
    });
  };

  const submit = async () => {
    if (busy) return;
    setMessage(null);
    if (!roomName.trim()) { setMessage('Name the match or tournament first.'); return; }
    if (mode === 'tournament' && selected.length !== entrantCount) {
      setMessage(`Select exactly ${entrantCount} players.`); return;
    }
    if (mode === 'match' && (selected.length < 2 || selected.length > capacity)) {
      setMessage(`Select 2 to ${capacity} players.`); return;
    }
    const date = new Date(startsAt);
    if (mode === 'match' && (!startsAt || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now() + 60_000)) {
      setMessage('Choose a future date and time.'); return;
    }
    if (mode === 'tournament') {
      const issue = validateArenaTournamentTimes(entrantCount, gameTimes, Date.now(), hasGroups);
      if (issue) { setMessage(issue); return; }
    }
    setBusy(true);
    try {
      if (mode === 'tournament') {
        await createInstructorArenaTournament({
          title: roomName.trim(), gameType, playerIds: selected,
          hasGroups,
          gameTimes: gameTimes.map((value) => new Date(value).toISOString()),
        });
      } else {
        await scheduleInstructorArenaMatch({ roomName: roomName.trim(), gameType, playerIds: selected, startsAt: date.toISOString() });
      }
      setSelected([]);
      setRoomName('');
      setStartsAt('');
      setGameTimes(Array(slots.length).fill(''));
      setMessage(mode === 'tournament' ? 'Tournament scheduled. First-round players have been notified.' : 'Match scheduled. The selected players have been notified.');
      await Promise.all([onScheduled(), refreshTournaments()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The schedule could not be created.');
    } finally { setBusy(false); }
  };

  const replayGame = async (gameId: string) => {
    const date = new Date(replayTimes[gameId] || '');
    if (!Number.isFinite(date.getTime()) || date.getTime() < Date.now() + 2 * 60_000) {
      setMessage('Choose a replay time at least two minutes from now.'); return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await rescheduleArenaTournamentGame(gameId, date.toISOString());
      await Promise.all([refreshTournaments(), onScheduled()]);
      setMessage('Replay scheduled. Both players have been notified.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The replay could not be scheduled.');
    } finally { setBusy(false); }
  };

  const cancelTournament = async (tournamentId: string) => {
    if (!window.confirm('Cancel this tournament before play begins?')) return;
    setBusy(true);
    setMessage(null);
    try {
      await cancelInstructorArenaTournament(tournamentId);
      await Promise.all([refreshTournaments(), onScheduled()]);
      setMessage('Tournament cancelled.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The tournament could not be cancelled.');
    } finally { setBusy(false); }
  };

  return <section className="border-b border-border pb-5">
    <div className="mb-4 flex items-center gap-2"><CalendarClock size={18} className="text-gold" /><h2 className="font-display text-base font-bold text-ink">Instructor Arena schedule</h2></div>
    <div className="mb-4 inline-flex rounded-md border border-border bg-surface-2 p-0.5" role="group" aria-label="Schedule type">
      <button type="button" className={`rounded px-3 py-1.5 text-xs font-bold ${mode === 'match' ? 'bg-surface text-ink shadow-sm' : 'text-stone'}`} onClick={() => { setMode('match'); setSelected((ids) => ids.slice(0, gameType === 'ludo' ? 4 : 8)); }}><Swords size={13} className="mr-1 inline" /> Match</button>
      <button type="button" className={`rounded px-3 py-1.5 text-xs font-bold ${mode === 'tournament' ? 'bg-surface text-ink shadow-sm' : 'text-stone'}`} onClick={() => { setMode('tournament'); setSelected((ids) => ids.slice(0, entrantCount)); }}><Trophy size={13} className="mr-1 inline" /> Tournament</button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold text-stone">{mode === 'tournament' ? 'Tournament name' : 'Match name'}<input className="input-field mt-1" value={roomName} maxLength={mode === 'tournament' ? 50 : 72} placeholder="Name the event" onChange={(event) => setRoomName(event.target.value)} /></label>
      {mode === 'match' && <label className="text-xs font-semibold text-stone">Start date and time<input className="input-field mt-1" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>}
    </div>
    <div className="mt-3 flex flex-wrap gap-3">
      <div className="w-44"><p className="mb-1 text-xs font-semibold text-stone">Game</p><AppSelect value={gameType} onChange={(value) => { setGameType(value as 'standard' | 'ludo'); if (mode === 'match') setSelected((ids) => ids.slice(0, value === 'ludo' ? 4 : 8)); }} options={[{ value: 'standard', label: 'Classic Trivia' }, { value: 'ludo', label: 'Ludo Trivia' }]} /></div>
      {mode === 'tournament' && <div className="w-44"><p className="mb-1 text-xs font-semibold text-stone">Start at</p><AppSelect value={startRound} onChange={(value) => { const next = value as ArenaTournamentStart; const count = arenaTournamentEntrants(next, groupEntrants); setStartRound(next); setSelected((ids) => ids.slice(0, count)); setGameTimes(Array(arenaTournamentSlots(count, next === 'groups').length).fill('')); }} options={[{ value: 'groups', label: 'Group stage' }, { value: 'round_of_16', label: 'Round of 16' }, { value: 'quarterfinal', label: 'Quarterfinals' }, { value: 'semifinal', label: 'Semifinals' }, { value: 'final', label: 'Final' }]} /></div>}
      {mode === 'tournament' && hasGroups && <div className="w-36"><p className="mb-1 text-xs font-semibold text-stone">Entrants</p><AppSelect value={String(groupEntrants)} onChange={(value) => { const count = Number(value) as 8 | 16 | 32; setGroupEntrants(count); setSelected((ids) => ids.slice(0, count)); setGameTimes(Array(arenaTournamentSlots(count, true).length).fill('')); }} options={[{ value: '8', label: '8 players' }, { value: '16', label: '16 players' }, { value: '32', label: '32 players' }]} /></div>}
    </div>
    <div className="relative mt-4"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone" /><input className="input-field pl-9" placeholder="Search players" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
      {visible.map((player) => {
        const checked = selected.includes(player.user_id);
        return <label key={player.user_id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-surface-2">
          <input type="checkbox" checked={checked} disabled={!checked && selected.length >= capacity} onChange={() => setSelected((ids) => checked ? ids.filter((id) => id !== player.user_id) : ids.length < capacity ? [...ids, player.user_id] : ids)} />
          <UserAvatar userId={player.user_id} name={player.profiles?.display_name} avatarUrl={player.profiles?.avatar_url} className="h-7 w-7" />
          <span className="truncate text-ink">{player.profiles?.display_name || 'Player'}</span>
        </label>;
      })}
    </div>
    {mode === 'tournament' && <>
      {selected.length > 0 && <div className="mt-4">
        <p className="text-xs font-semibold text-stone">{hasGroups ? 'Group placement' : 'First-round pairings'}</p>
        <div className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-2">
          {selected.map((id, index) => {
            const player = players.find((item) => item.user_id === id);
            return <div key={id} className="flex min-w-0 items-center gap-1 border-b border-border py-1 text-xs">
              <span className="w-7 shrink-0 text-stone">{hasGroups ? `${String.fromCharCode(65 + Math.floor(index / 4))}${index % 4 + 1}` : index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{player?.profiles?.display_name || 'Player'}</span>
              <button type="button" className="btn-ghost h-7 w-7 p-0" title="Move up" aria-label={`Move ${player?.profiles?.display_name || 'player'} up`} disabled={index === 0} onClick={() => moveSelected(index, -1)}><ArrowUp size={13} /></button>
              <button type="button" className="btn-ghost h-7 w-7 p-0" title="Move down" aria-label={`Move ${player?.profiles?.display_name || 'player'} down`} disabled={index === selected.length - 1} onClick={() => moveSelected(index, 1)}><ArrowDown size={13} /></button>
            </div>;
          })}
        </div>
      </div>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {slots.map((slot) => <label key={slot.index} className="text-xs font-semibold text-stone">{slot.label} · date and time
          <input className="input-field mt-1" type="datetime-local" value={gameTimes[slot.index] || ''} onChange={(event) => setGameTimes((current) => current.map((value, index) => index === slot.index ? event.target.value : value))} />
        </label>)}
      </div>
    </>}
    <div className="mt-4 flex flex-wrap items-center gap-3"><button className="btn-primary text-xs" type="button" onClick={() => void submit()} disabled={busy || !roomName.trim() || (mode === 'tournament' ? selected.length !== entrantCount : selected.length < 2)}><Swords size={14} /> {busy ? <Loader2 size={14} className="animate-spin" /> : mode === 'tournament' ? 'Schedule tournament' : 'Schedule match'}</button><span className="text-xs text-stone">{selected.length}/{capacity} players</span></div>
    {message && <p role="status" className="mt-2 text-xs text-stone">{message}</p>}

    <div className="mt-7 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3"><h3 className="font-display text-sm font-bold text-ink">Tournaments</h3><button type="button" className="btn-ghost h-8 w-8 p-0" title="Refresh tournaments" aria-label="Refresh tournaments" onClick={() => void refreshTournaments().catch(() => setMessage('The tournament schedule could not refresh.'))}><RotateCw size={14} /></button></div>
      {tournaments.length === 0 && <p className="mt-2 text-xs text-stone">No tournaments scheduled.</p>}
      {tournaments.map((tournament) => {
        const playerName = (id: string | null) => id ? shortestArenaName(tournament.players.find((player) => player.id === id)?.display_name || 'Player') : 'TBD';
        return <div key={tournament.id} className="border-b border-border py-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="truncate font-display text-sm font-bold text-ink">{tournament.title}</p><p className="text-[11px] capitalize text-stone">{tournament.status}{tournament.champion_id ? ` · Champion: ${playerName(tournament.champion_id)}` : ''}</p></div>{tournament.status === 'scheduled' && <button type="button" className="btn-ghost text-xs text-coral" disabled={busy} onClick={() => void cancelTournament(tournament.id)}>Cancel</button>}</div>
          <div className="mt-2 divide-y divide-border">
            {tournament.games.map((game) => {
              const endedWithoutWinner = !game.winner_id && game.left_player_id && game.right_player_id && ['completed', 'cancelled', 'expired'].includes(game.room_status || '');
              const label = arenaTournamentSlots(tournament.players.length, tournament.has_group_stage).find((slot) => slot.round === game.round_number && slot.match === game.match_number)?.label || `Round ${game.round_number}`;
              return <div key={game.id} className="py-2 text-[11px]">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><span className="font-semibold text-ink">{label}: {playerName(game.left_player_id)} vs {playerName(game.right_player_id)}</span><span className="text-stone">{new Date(game.starts_at || game.planned_at).toLocaleString()}</span></div>
                {game.winner_id && <p className="text-gold">Winner: {playerName(game.winner_id)}</p>}
                {endedWithoutWinner && tournament.status !== 'cancelled' && <div className="mt-2 flex flex-wrap gap-2"><input className="input-field min-w-0 flex-1 text-xs" aria-label={`Replay time for ${label}`} type="datetime-local" value={replayTimes[game.id] || ''} onChange={(event) => setReplayTimes((current) => ({ ...current, [game.id]: event.target.value }))} /><button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => void replayGame(game.id)}>Schedule replay</button></div>}
              </div>;
            })}
          </div>
        </div>;
      })}
    </div>
  </section>;
}
