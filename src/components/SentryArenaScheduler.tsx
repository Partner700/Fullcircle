import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { regionalDateTime } from '../lib/regionalPreferences';
import { getAppDateTimeMs } from '../lib/utils';

type Cadet = { user_id: string; profiles: { display_name: string } };

export type SentryScheduleRoster = { tentId: string; members: Cadet[] };

export function SentryArenaScheduler({ tentId, members, onScheduled }: SentryScheduleRoster & {
  onScheduled: () => void;
}) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [game, setGame] = useState('standard');
  const [time, setTime] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const players = selected.filter(id => members.some(member => member.user_id === id));
  const campTime = time.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  const startsAt = campTime
    ? new Date(getAppDateTimeMs(campTime[1], Number(campTime[2]), Number(campTime[3])))
    : null;

  const schedule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || players.length < 2 || players.length > 4) return;
    if (!startsAt || !Number.isFinite(startsAt.getTime())) {
      setStatus('Choose a start date and time.');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      const { error } = await supabase.rpc('schedule_sentry_arena_match', {
        p_tent_id: tentId,
        p_room_name: title,
        p_game_type: game,
        p_player_ids: players,
        p_starts_at: startsAt.toISOString(),
      });
      if (error) {
        setStatus(error.code === 'P0001' ? error.message : 'Could not schedule the match. Please try again.');
        return;
      }
      setStatus('Match scheduled. The selected cadets will receive an Arena notification.');
      setOpen(false);
      setSelected([]);
      setTime('');
      setTitle('');
      onScheduled();
    } catch {
      setStatus('Could not confirm the match. Check the Arena before trying again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-3 p-4">
      <h3 className="font-display font-bold text-ink">Schedule a tent match</h3>
      <p className="text-xs text-stone">Choose 2 to 4 cadets from your tent for a single Arena match.</p>
      {members.length < 2 ? <p className="text-sm text-stone">You need at least two cadets in your tent.</p> : (
        <button type="button" className="btn-secondary text-xs" aria-expanded={open}
          disabled={busy} onClick={() => { setOpen(!open); setStatus(''); }}>
          {open ? 'Close scheduler' : 'Schedule match'}
        </button>
      )}
      {open && members.length >= 2 && (
        <form className="space-y-3" onSubmit={schedule}>
          <label className="block text-sm text-ink">
            Match name (optional)
            <input className="input mt-1 w-full" value={title} maxLength={72} onChange={event => setTitle(event.target.value)} />
          </label>
          <label className="block text-sm text-ink">
            Game
            <select className="input mt-1 w-full" value={game} onChange={event => setGame(event.target.value)}>
              <option value="standard">Classic Trivia</option>
              <option value="ludo">Ludo Trivia</option>
            </select>
          </label>
          <label className="block text-sm text-ink">
            Start date and time (Douala)
            <input className="input mt-1 w-full" type="datetime-local" required value={time}
              onChange={event => setTime(event.target.value)} />
          </label>
          {startsAt && <p className="text-xs text-stone"><span>Your local time</span> · {regionalDateTime(startsAt, profile)}</p>}
          <fieldset className="space-y-2" disabled={busy}>
            <legend className="text-sm font-semibold text-ink">Cadets ({players.length}/4)</legend>
            {members.map(member => {
              const checked = players.includes(member.user_id);
              return (
                <label key={member.user_id} className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={checked} disabled={!checked && players.length >= 4}
                    onChange={() => setSelected(checked ? players.filter(id => id !== member.user_id) : [...players, member.user_id])} />
                  {member.profiles.display_name}
                </label>
              );
            })}
          </fieldset>
          <button className="btn-primary text-xs" type="submit" disabled={busy || players.length < 2}>
            {busy ? 'Scheduling…' : 'Confirm match'}
          </button>
        </form>
      )}
      {status && <p className="text-sm text-ink" role="status">{status}</p>}
    </section>
  );
}
