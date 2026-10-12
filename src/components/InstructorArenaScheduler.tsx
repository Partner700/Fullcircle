import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Loader2, Search, Swords } from 'lucide-react';
import { AppSelect } from './AppSelect';
import { UserAvatar } from './UserAvatar';
import { fetchArenaInvitees, scheduleInstructorArenaMatch } from '../lib/queries';
import type { Profile, RoleAssignment } from '../lib/types';

type Player = RoleAssignment & { profiles: Profile };

export function InstructorArenaScheduler({ onScheduled }: { onScheduled: () => Promise<void> | void }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [roomName, setRoomName] = useState('Instructor Match');
  const [gameType, setGameType] = useState<'standard' | 'ludo'>('standard');
  const [startsAt, setStartsAt] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const visible = useMemo(() => players.filter((player) =>
    player.profiles?.display_name?.toLowerCase().includes(search.trim().toLowerCase())), [players, search]);
  const capacity = gameType === 'ludo' ? 4 : 8;

  useEffect(() => {
    let active = true;
    void fetchArenaInvitees().then((items) => { if (active) setPlayers(items as Player[]); })
      .catch(() => { if (active) setMessage('The player list could not load.'); });
    return () => { active = false; };
  }, []);

  const submit = async () => {
    if (busy) return;
    setMessage(null);
    if (selected.length < 2 || selected.length > capacity) {
      setMessage(`Select 2 to ${capacity} players.`); return;
    }
    const date = new Date(startsAt);
    if (!startsAt || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now() + 60_000) {
      setMessage('Choose a future date and time.'); return;
    }
    setBusy(true);
    try {
      await scheduleInstructorArenaMatch({ roomName, gameType, playerIds: selected, startsAt: date.toISOString() });
      setSelected([]);
      setRoomName('Instructor Match');
      setStartsAt('');
      setMessage('Match scheduled. The selected players have been notified.');
      await onScheduled();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The match could not be scheduled.');
    } finally { setBusy(false); }
  };

  return <section className="border-b border-border pb-5">
    <div className="mb-4 flex items-center gap-2"><CalendarClock size={18} className="text-gold" /><h2 className="font-display text-base font-bold text-ink">Schedule an Arena match</h2></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold text-stone">Match name<input className="input-field mt-1" value={roomName} maxLength={72} onChange={(event) => setRoomName(event.target.value)} /></label>
      <label className="text-xs font-semibold text-stone">Start date and time<input className="input-field mt-1" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
    </div>
    <div className="mt-3 max-w-xs"><p className="mb-1 text-xs font-semibold text-stone">Game</p><AppSelect value={gameType} onChange={(value) => { setGameType(value as 'standard' | 'ludo'); setSelected((ids) => ids.slice(0, value === 'ludo' ? 4 : 8)); }} options={[{ value: 'standard', label: 'Standard Trivia' }, { value: 'ludo', label: 'Ludo Trivia' }]} /></div>
    <div className="relative mt-4"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone" /><input className="input-field pl-9" placeholder="Search players" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
      {visible.map((player) => {
        const checked = selected.includes(player.user_id);
        return <label key={player.user_id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-surface-2">
          <input type="checkbox" checked={checked} onChange={() => setSelected((ids) => checked ? ids.filter((id) => id !== player.user_id) : ids.length < capacity ? [...ids, player.user_id] : ids)} />
          <UserAvatar userId={player.user_id} name={player.profiles?.display_name} avatarUrl={player.profiles?.avatar_url} className="h-7 w-7" />
          <span className="truncate text-ink">{player.profiles?.display_name || 'Player'}</span>
        </label>;
      })}
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-3"><button className="btn-primary text-xs" type="button" onClick={() => void submit()} disabled={busy || selected.length < 2}><Swords size={14} /> {busy ? <Loader2 size={14} className="animate-spin" /> : 'Schedule match'}</button><span className="text-xs text-stone">{selected.length}/{capacity} players</span></div>
    {message && <p role="status" className="mt-2 text-xs text-stone">{message}</p>}
  </section>;
}
