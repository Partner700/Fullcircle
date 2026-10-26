import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Loader2, RotateCw, Save, Search, Swords, Trophy } from 'lucide-react';
import { AppSelect } from './AppSelect';
import { UserAvatar } from './UserAvatar';
import {
  cancelInstructorArenaTournament, createInstructorArenaTournament, fetchArenaInvitees,
  fetchArenaTournaments, rescheduleArenaTournamentGame, scheduleInstructorArenaMatch,
  setArenaTournamentGamePlayers,
  type ArenaTournament,
} from '../lib/queries';
import { arenaTournamentEntrants, arenaTournamentSlots, tournamentAutomaticPlayerLabel, tournamentFixtureRoster, validateTournamentFixturePlayers, validateArenaTournamentTimes, type ArenaTournamentPair, type ArenaTournamentStart } from '../lib/arenaTournament';
import { userFacingError } from '../lib/connectionErrors';
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
  const [gamePlayers, setGamePlayers] = useState<ArenaTournamentPair[]>(Array.from({ length: 7 }, () => ['', '']));
  const [fixtureDrafts, setFixtureDrafts] = useState<Record<string, ArenaTournamentPair>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const visible = useMemo(() => players.filter((player) =>
    player.profiles?.display_name?.toLowerCase().includes(search.trim().toLowerCase())), [players, search]);
  const entrantCount = arenaTournamentEntrants(startRound, groupEntrants);
  const hasGroups = startRound === 'groups';
  const capacity = mode === 'tournament' ? entrantCount : gameType === 'ludo' ? 4 : 8;
  const slots = arenaTournamentSlots(entrantCount, hasGroups);
  const tournamentRoster = tournamentFixtureRoster(slots, gamePlayers);
  const resetFixtures = (count: number, groups: boolean) => {
    const length = arenaTournamentSlots(count, groups).length;
    setGameTimes(Array(length).fill(''));
    setGamePlayers(Array.from({ length }, () => ['', '']));
  };

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

  const saveFixturePlayers = async (tournament: ArenaTournament) => {
    if (busy) return;
    const changes = tournament.games.flatMap((game) => {
      const pair = fixtureDrafts[game.id];
      return pair && (pair[0] !== (game.left_override_id || '') || pair[1] !== (game.right_override_id || ''))
        ? [{ game_id: game.id, player_ids: pair }] : [];
    });
    if (!changes.length) return;
    setBusy(true);
    setMessage(null);
    try {
      await setArenaTournamentGamePlayers(tournament.id, changes);
      setFixtureDrafts((current) => Object.fromEntries(Object.entries(current)
        .filter(([id]) => !tournament.games.some((game) => game.id === id))));
      await Promise.all([refreshTournaments(), onScheduled()]);
      setMessage('Tournament match players updated.');
    } catch (error) {
      setMessage(userFacingError(error, 'The match players could not be updated.'));
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (busy) return;
    setMessage(null);
    if (!roomName.trim()) { setMessage('Name the match or tournament first.'); return; }
    if (mode === 'tournament') {
      const issue = validateTournamentFixturePlayers(slots, gamePlayers);
      if (issue) { setMessage(issue); return; }
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
          title: roomName.trim(), gameType, playerIds: tournamentRoster,
          hasGroups, gamePlayers,
          gameTimes: gameTimes.map((value) => new Date(value).toISOString()),
        });
      } else {
        await scheduleInstructorArenaMatch({ roomName: roomName.trim(), gameType, playerIds: selected, startsAt: date.toISOString() });
      }
      setSelected([]);
      setRoomName('');
      setStartsAt('');
      resetFixtures(entrantCount, hasGroups);
      setMessage(mode === 'tournament' ? 'Tournament scheduled. First-round players have been notified.' : 'Match scheduled. The selected players have been notified.');
      await Promise.all([onScheduled(), refreshTournaments()]);
    } catch (error) {
      setMessage(userFacingError(error, 'The schedule could not be created.'));
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
      setMessage(userFacingError(error, 'The replay could not be scheduled.'));
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
      setMessage(userFacingError(error, 'The tournament could not be cancelled.'));
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
      {mode === 'tournament' && <div className="w-44"><p className="mb-1 text-xs font-semibold text-stone">Start at</p><AppSelect value={startRound} onChange={(value) => { const next = value as ArenaTournamentStart; const count = arenaTournamentEntrants(next, groupEntrants); setStartRound(next); setSelected((ids) => ids.slice(0, count)); resetFixtures(count, next === 'groups'); }} options={[{ value: 'groups', label: 'Group stage' }, { value: 'round_of_16', label: 'Round of 16' }, { value: 'quarterfinal', label: 'Quarterfinals' }, { value: 'semifinal', label: 'Semifinals' }, { value: 'final', label: 'Final' }]} /></div>}
      {mode === 'tournament' && hasGroups && <div className="w-36"><p className="mb-1 text-xs font-semibold text-stone">Entrants</p><AppSelect value={String(groupEntrants)} onChange={(value) => { const count = Number(value) as 8 | 16 | 32; setGroupEntrants(count); setSelected((ids) => ids.slice(0, count)); resetFixtures(count, true); }} options={[{ value: '8', label: '8 players' }, { value: '16', label: '16 players' }, { value: '32', label: '32 players' }]} /></div>}
    </div>
    {mode === 'match' && <><div className="relative mt-4"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone" /><input className="input-field pl-9" placeholder="Search players" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
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
    </>}
    {mode === 'tournament' && <>
      <div className="mt-4 divide-y divide-border">
        {slots.map((slot) => {
          const pair = gamePlayers[slot.index] || ['', ''];
          const firstRound = slot.round === slots[0].round;
          const candidates = firstRound ? players : players.filter((player) => tournamentRoster.includes(player.user_id) || pair.includes(player.user_id));
          return <fieldset key={slot.index} className="min-w-0 py-4" data-tournament-fixture={slot.label}>
            <legend className="float-left mb-2 w-full font-display text-sm font-bold text-ink">{slot.label}</legend>
            <label className="block clear-both text-xs font-semibold text-stone">Date and time
              <input className="input-field mt-1 min-w-0" type="datetime-local" aria-label={`${slot.label} date and time`} value={gameTimes[slot.index] || ''} onChange={(event) => setGameTimes((current) => current.map((value, index) => index === slot.index ? event.target.value : value))} />
            </label>
            <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
              {([0, 1] as const).map((side) => <div key={side} className="min-w-0">
                <p className="mb-1 text-xs font-semibold text-stone">Player {side + 1}</p>
                <AppSelect value={pair[side]} searchable ariaLabel={`${slot.label} player ${side + 1}`}
                  disabled={busy} onChange={(id) => setGamePlayers((current) => current.map((value, index) => index === slot.index
                    ? side === 0 ? [id, value[1]] : [value[0], id] : value))}
                  placeholder="Choose player"
                  options={[{ value: '', label: firstRound ? 'Choose player' : `Automatic: ${tournamentAutomaticPlayerLabel(slots, slot, side)}` },
                    ...candidates.filter((player) => player.user_id !== pair[1 - side])
                      .map((player) => ({ value: player.user_id, label: player.profiles?.display_name || 'Player' }))]} />
              </div>)}
            </div>
          </fieldset>;
        })}
      </div>
    </>}
    <div className="mt-4 flex flex-wrap items-center gap-3"><button className="btn-primary text-xs" type="button" onClick={() => void submit()} disabled={busy || !roomName.trim() || (mode === 'match' && selected.length < 2)}><Swords size={14} /> {busy ? <Loader2 size={14} className="animate-spin" /> : mode === 'tournament' ? 'Schedule tournament' : 'Schedule match'}</button><span className="text-xs text-stone">{mode === 'tournament' ? tournamentRoster.length : selected.length}/{capacity} players</span></div>
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
              const tournamentSlots = arenaTournamentSlots(tournament.players.length, tournament.has_group_stage);
              const slot = tournamentSlots.find((item) => item.round === game.round_number && item.match === game.match_number)!;
              const pair = fixtureDrafts[game.id] || [game.left_override_id || '', game.right_override_id || ''];
              const group = game.round_number === 0 ? Math.floor((game.match_number - 1) / 6) : null;
              const candidates = group === null ? tournament.players : tournament.players.slice(group * 4, group * 4 + 4);
              const automatic = [game.automatic_left_player_id, game.automatic_right_player_id];
              const canEdit = game.can_edit_players && !['cancelled', 'completed'].includes(tournament.status);
              return <div key={game.id} className="py-4 text-[11px]" data-tournament-fixture={label}>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><span className="font-semibold text-ink">{label}</span><span className="text-stone">{new Date(game.starts_at || game.planned_at).toLocaleString()}</span></div>
                <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
                  {([0, 1] as const).map((side) => <div key={side} className="min-w-0">
                    <p className="mb-1 text-xs font-semibold text-stone">Player {side + 1}</p>
                    <AppSelect value={pair[side]} searchable ariaLabel={`${tournament.title} ${label} player ${side + 1}`}
                      disabled={!canEdit || busy}
                      onChange={(id) => setFixtureDrafts((current) => ({ ...current, [game.id]: side === 0 ? [id, pair[1]] : [pair[0], id] }))}
                      options={[{ value: '', label: automatic[side]
                        ? `Automatic: ${tournament.players.find((player) => player.id === automatic[side])?.display_name || 'Player'}`
                        : `Automatic: ${tournamentAutomaticPlayerLabel(tournamentSlots, slot, side)}` },
                        ...candidates.map((player) => ({ value: player.id, label: player.display_name }))]} />
                  </div>)}
                </div>
                {game.winner_id && <p className="mt-2 text-gold">Winner: {playerName(game.winner_id)}</p>}
                {endedWithoutWinner && tournament.status !== 'cancelled' && <div className="mt-2 flex flex-wrap gap-2"><input className="input-field min-w-0 flex-1 text-xs" aria-label={`Replay time for ${label}`} type="datetime-local" value={replayTimes[game.id] || ''} onChange={(event) => setReplayTimes((current) => ({ ...current, [game.id]: event.target.value }))} /><button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => void replayGame(game.id)}>Schedule replay</button></div>}
              </div>;
            })}
          </div>
          {tournament.games.some((game) => fixtureDrafts[game.id]) && <button type="button" className="btn-primary mt-3 text-xs" disabled={busy} onClick={() => void saveFixturePlayers(tournament)}><Save size={14} /> Save participants</button>}
        </div>;
      })}
    </div>
  </section>;
}
