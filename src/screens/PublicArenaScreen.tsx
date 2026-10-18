import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Eye, Loader2, Swords, UserPlus, Users } from 'lucide-react';
import { ArenaMatchCountdown } from '../components/ArenaMatchCountdown';
import { ArenaFinalScorecard } from '../components/ArenaFinalScorecard';
import { ArenaRoomChat } from '../components/ArenaRoomChat';
import { Dove } from '../components/Dove';
import { UserAvatar } from '../components/UserAvatar';
import { fetchArenaFinalScorecard, fetchPublicArenaRoom, fetchPublicArenaSuccessor, registerPublicArenaWitness, type PublicArenaRoom } from '../lib/queries';
import { setScenarioSound } from '../lib/soundscape';
import { ArenaStandardSpectator } from './cadet/CadetArena';
import { RoadHomeGame } from './cadet/RoadHomeGame';
import { JourneyGamePlay } from './cadet/JourneyGamePlay';

function arenaGuestKey(roomId: string) {
  const storageKey = `full-circle-arena-guest:${roomId}`;
  const created = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) return saved;
    window.localStorage.setItem(storageKey, created);
    return created;
  } catch {
    return created;
  }
}

export function PublicArenaScreen({ roomId }: { roomId: string }) {
  const [currentRoomId, setCurrentRoomId] = useState(roomId);
  const [room, setRoom] = useState<PublicArenaRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const roomRef = useRef<PublicArenaRoom | null>(null);
  const guestKey = useMemo(() => arenaGuestKey(roomId), [roomId]);
  const signupHref = `${window.location.pathname}?signup=1`;
  const reload = useCallback(async () => {
    let following = false;
    try {
      const latest = await fetchPublicArenaRoom(currentRoomId);
      if (latest) {
        roomRef.current = latest;
        setRoom(latest);
        setError(null);
      } else {
        const successor = await fetchPublicArenaSuccessor(currentRoomId);
        if (successor && successor !== currentRoomId) {
          following = true;
          roomRef.current = null;
          setRoom(null);
          setLoading(true);
          setCurrentRoomId(successor);
          return;
        }
        if (roomRef.current) setEnded(true);
        else {
          const finalScore = await fetchArenaFinalScorecard(currentRoomId);
          if (finalScore) setEnded(true);
          else setError('This Arena room is no longer open.');
        }
      }
    } catch (loadError) {
      if (!roomRef.current) setError(loadError instanceof Error ? loadError.message : 'The Arena could not load.');
    } finally {
      if (!following) setLoading(false);
    }
  }, [currentRoomId]);

  useEffect(() => {
    setCurrentRoomId(roomId);
    roomRef.current = null;
    setRoom(null);
    setEnded(false);
    setLoading(true);
  }, [roomId]);

  useEffect(() => {
    if (ended) return;
    void reload();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [ended, reload]);

  useEffect(() => {
    if (!roomRef.current || ended) return;
    void registerPublicArenaWitness(currentRoomId, guestKey).catch(() => undefined);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void registerPublicArenaWitness(currentRoomId, guestKey).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [currentRoomId, ended, guestKey, room?.id]);

  useEffect(() => {
    void setScenarioSound(ended ? null : room?.status === 'playing' ? 'sound_game_level_1' : room?.status === 'waiting' ? 'sound_arena_lobby' : null);
    return () => { void setScenarioSound(null); };
  }, [ended, room?.status]);

  const participants = room?.participants || [];
  const players = room?.selected_players.length ? room.selected_players : participants;
  const isJourney = Boolean(room && /\[arena:journey\]/i.test(room.room_name));
  const arenaRoom = room ? {
    ...room,
    arena_participants: participants.map((player) => ({
      user_id: player.user_id,
      profiles: { display_name: player.display_name, avatar_url: player.avatar_url },
    })),
  } : null;

  return (
    <main className="min-h-screen bg-navy px-4 py-6 text-ink">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex items-center justify-between gap-3">
          <a href={window.location.pathname} className="flex items-center gap-2 text-peri"><Dove size={34} /><span className="font-display text-lg font-black">Full Circle</span></a>
          <a href={signupHref} className="btn-primary text-xs"><UserPlus size={14} /> Join Full Circle</a>
        </header>

        {loading && !room && <div className="flex min-h-60 items-center justify-center gap-2 text-stone"><Loader2 size={18} className="animate-spin" /> Opening the Arena...</div>}
        {error && !room && !ended && <section className="card p-6 text-center"><Swords size={30} className="mx-auto text-gold" /><h1 className="mt-3 font-display text-xl font-bold">Arena room unavailable</h1><p className="mt-2 text-sm text-stone">{error}</p><a href={signupHref} className="btn-primary mt-4">Join Full Circle</a></section>}
        {room && <>
          <section className="border-b border-border pb-4">
            <p className="eyebrow text-brass">Arena · {isJourney ? 'The Biblical Journey' : room.game_type === 'ludo' ? 'Ludo Trivia' : 'Standard Trivia'}</p>
            <h1 className="mt-1 font-display text-2xl font-bold text-ink">{room.room_name.replace(/\s*\[[^]]+\]/g, '')}</h1>
            <p className="mt-2 flex items-center gap-2 text-xs text-stone"><Eye size={14} /> {room.witness_count} witnessing <span aria-hidden="true">·</span> <Users size={14} /> {participants.length}/{room.max_players} players</p>
          </section>
          {!ended && (room.status === 'waiting' ? <section className="space-y-4">
              {room.starts_at && <ArenaMatchCountdown startsAt={room.starts_at} />}
              <div className="flex flex-wrap justify-center gap-3">
                {players.map((player) => <div key={player.user_id} className="flex items-center gap-2 text-xs text-ink"><UserAvatar userId={player.user_id} name={player.display_name} avatarUrl={player.avatar_url} className="h-9 w-9" /><span>{player.display_name}</span></div>)}
              </div>
              <ArenaRoomChat roomId={currentRoomId} userId="" guestKey={guestKey} />
            </section> : isJourney ? <JourneyGamePlay key={currentRoomId} roomId={currentRoomId} roomName={room.room_name} userId=""
              spectator guestKey={guestKey} players={players.map((player) => ({
                user_id: player.user_id, display_name: player.display_name, avatar_url: player.avatar_url,
                tent_house_id: null, correct_count: participants.find((item) => item.user_id === player.user_id)?.score || 0,
              }))} onExit={() => window.location.assign(window.location.pathname)} />
              : room.game_type === 'ludo' ? <RoadHomeGame key={currentRoomId} roomId={currentRoomId} roomName={room.room_name} userId="" spectator publicAccess awaitSeriesResult={room.scheduled && room.play_mode !== 'machine' && room.max_players <= 4} guestKey={guestKey} spectatorCanChallenge={false} onExit={() => window.location.assign(window.location.pathname)} />
              : arenaRoom && <ArenaStandardSpectator room={arenaRoom} userId="" publicAccess guestKey={guestKey} allowChallenges={false} onExit={() => window.location.assign(window.location.pathname)} onGameCallCreated={async () => undefined} onGameCallAction={async () => undefined} />)}
          <div className="flex justify-center border-t border-border pt-4"><a href={signupHref} className="btn-secondary text-xs"><UserPlus size={14} /> Join Full Circle to play or challenge</a></div>
        </>}
        {ended && <ArenaFinalScorecard roomId={currentRoomId} />}
        <a href={window.location.pathname} className="btn-ghost text-xs"><ArrowLeft size={14} /> Full Circle</a>
      </div>
    </main>
  );
}
