import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, EmptyState } from '../../components/AppShell';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { RoadHomeGame } from './RoadHomeGame';
import { supabase } from '../../lib/supabase';
import {
  fetchLedgerTotal,
  createArenaRoom,
  createMachineArenaRoom,
  inviteArenaPlayers,
  joinArenaRoom,
  startArenaRoom,
  closeArenaRoom,
  forfeitArenaGame,
  heartbeatArenaParticipant,
  finishArenaGame,
  submitArenaTriviaAnswer,
  fetchArenaTriviaFeed,
  fetchArenaRoomMessages,
  sendArenaRoomMessage,
  fetchArenaRooms,
  fetchArenaRoom,
  fetchNarratives,
  fetchActiveCadets,
  generateArenaQuestionsWithAI,
  fetchPanelImageSetting,
} from '../../lib/queries';
import { playSoundEffect, setScenarioSound } from '../../lib/soundscape';
import { cn, formatDenarii } from '../../lib/utils';
import { ARENA_GAME_CALL_FEE } from '../../lib/constants';
import type { DailyNarrative, QuestionPayload, Profile, RoleAssignment, PanelImageSetting } from '../../lib/types';
import type { ArenaTriviaFeedItem } from '../../lib/queries';
import {
  Swords, Users, Coins, Loader2, Zap, Trophy, Play, Plus, Clock, CheckCircle2, XCircle, UserPlus, Search, MessageCircle, Send, Flag,
} from 'lucide-react';

type ArenaPhase = 'lobby' | 'waiting' | 'playing' | 'finished';
type InviteCadet = RoleAssignment & { profiles: Profile };
const activeArenaRoomKey = (userId: string) => `full-circle-active-arena-room-${userId}`;
const dismissedArenaRoomsKey = (userId: string) => `full-circle-dismissed-arena-rooms-${userId}`;

interface CadetArenaProps {
  onBalanceChanged?: () => Promise<void> | void;
}

export function CadetArena({ onBalanceChanged }: CadetArenaProps) {
  const { profile } = useAuth();
  const [phase, setPhase] = useState<ArenaPhase>('lobby');
  const [rooms, setRooms] = useState<any[]>([]);
  const [denarii, setDenarii] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [roomName, setRoomName] = useState('Quick Match');
  const [stake, setStake] = useState(50);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [narratives, setNarratives] = useState<DailyNarrative[]>([]);
  const [selectedNarrativeDate, setSelectedNarrativeDate] = useState<string>('');
  const [arenaTopicType, setArenaTopicType] = useState<'narrative' | 'book' | 'character'>('narrative');
  const [arenaTopic, setArenaTopic] = useState('');
  const [arenaOpponent, setArenaOpponent] = useState<'players' | 'machine'>('players');
  const [arenaGameType, setArenaGameType] = useState<'standard' | 'ludo'>('standard');
  const [arenaDifficulty, setArenaDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [forfeiting, setForfeiting] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allCadets, setAllCadets] = useState<InviteCadet[]>([]);
  const [taggedIds, setTaggedIds] = useState<Set<string>>(new Set());
  const [cadetSearch, setCadetSearch] = useState('');
  const [arenaImage, setArenaImage] = useState<PanelImageSetting | null>(null);
  const previousSoundPhase = useRef<ArenaPhase | null>(null);

  useEffect(() => {
    void setScenarioSound(phase === 'lobby' || phase === 'waiting' ? 'sound_arena_lobby' : null);
    if (phase === 'playing' && previousSoundPhase.current !== 'playing') {
      void playSoundEffect('sound_arena_start', 0.68);
    }
    if (phase === 'finished' && previousSoundPhase.current !== 'finished') {
      void playSoundEffect('sound_arena_finish', 0.68);
    }
    previousSoundPhase.current = phase;
    return () => { void setScenarioSound(null); };
  }, [phase]);

  useEffect(() => {
    if (!profile) return;
    const savedRoomId = window.localStorage.getItem(activeArenaRoomKey(profile.id));
    const dismissed = new Set(JSON.parse(window.localStorage.getItem(dismissedArenaRoomsKey(profile.id)) || '[]'));
    if (savedRoomId && !dismissed.has(savedRoomId)) setActiveRoomId(savedRoomId);
    if (savedRoomId && dismissed.has(savedRoomId)) window.localStorage.removeItem(activeArenaRoomKey(profile.id));
  }, [profile]);

  useEffect(() => {
    if (!profile || !activeRoomId) return;
    window.localStorage.setItem(activeArenaRoomKey(profile.id), activeRoomId);
  }, [profile, activeRoomId]);

  const clearActiveRoom = useCallback((dismiss = false) => {
    if (profile && activeRoomId) {
      window.localStorage.removeItem(activeArenaRoomKey(profile.id));
      if (dismiss) {
        const key = dismissedArenaRoomsKey(profile.id);
        const dismissed = new Set<string>(JSON.parse(window.localStorage.getItem(key) || '[]'));
        dismissed.add(activeRoomId);
        window.localStorage.setItem(key, JSON.stringify(Array.from(dismissed).slice(-20)));
      }
    }
    setActiveRoomId(null);
    setPhase('lobby');
  }, [activeRoomId, profile]);

  const activateRoom = useCallback((roomId: string, nextPhase: ArenaPhase = 'waiting') => {
    if (profile) {
      const dismissedKey = dismissedArenaRoomsKey(profile.id);
      const dismissed = new Set<string>(JSON.parse(window.localStorage.getItem(dismissedKey) || '[]'));
      dismissed.delete(roomId);
      window.localStorage.setItem(dismissedKey, JSON.stringify(Array.from(dismissed)));
      window.localStorage.setItem(activeArenaRoomKey(profile.id), roomId);
    }
    setActiveRoomId(roomId);
    setPhase(nextPhase);
  }, [profile]);

  const load = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    try {
      const [roomsData, balance, narrs, cadets, panelImage] = await Promise.allSettled([
        fetchArenaRooms(),
        fetchLedgerTotal(profile.id),
        fetchNarratives(30),
        fetchActiveCadets(),
        fetchPanelImageSetting('arena'),
      ]);
      setRooms(roomsData.status === 'fulfilled' ? roomsData.value : []);
      setDenarii(balance.status === 'fulfilled' ? balance.value : 0);
      setNarratives(narrs.status === 'fulfilled' ? narrs.value : []);
      setAllCadets((cadets.status === 'fulfilled' ? cadets.value : []).filter((c) => c.user_id !== profile.id));
      setArenaImage(panelImage.status === 'fulfilled' ? panelImage.value : null);
      if (narrs.status === 'fulfilled' && narrs.value && narrs.value.length > 0 && !selectedNarrativeDate) setSelectedNarrativeDate(narrs.value[0].narrative_date);
    } catch (e) { console.error('Arena load error:', e); }
    setLoading(false);
  }, [profile, selectedNarrativeDate]);

  useEffect(() => { load(); }, [load]);

  // Realtime subscription for room updates
  useEffect(() => {
    if (!activeRoomId) return;
    const channel = supabase
      .channel(`arena_room_${activeRoomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arena_participants', filter: `room_id=eq.${activeRoomId}` },
        () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arena_rooms', filter: `id=eq.${activeRoomId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeRoomId, load]);

  useEffect(() => {
    if (!profile || !activeRoomId || phase !== 'playing') return;
    let cancelled = false;
    const heartbeat = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const active = await heartbeatArenaParticipant(activeRoomId, profile.id);
        if (!active && !cancelled) {
          const freshRoom = await fetchArenaRoom(activeRoomId).catch(() => null);
          const participant = freshRoom?.arena_participants?.find((item: any) => item.user_id === profile.id);
          setError(participant?.forfeit_reason === 'manual'
            ? 'You forfeited this Arena match.'
            : 'You were away from this Arena match for three minutes and forfeited your place.');
          clearActiveRoom(true);
        }
      } catch { /* Realtime room state handles matches that have just completed. */ }
    };
    void heartbeat();
    const interval = window.setInterval(() => { void heartbeat(); }, 20_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') void heartbeat(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [activeRoomId, clearActiveRoom, phase, profile]);

  useEffect(() => {
    if (!activeRoomId) return;
    const room = rooms.find((r) => r.id === activeRoomId);
    if (!room) {
      fetchArenaRoom(activeRoomId)
        .then((freshRoom) => {
          if (!freshRoom) return;
          setRooms((prev) => [freshRoom, ...prev.filter((item) => item.id !== freshRoom.id)]);
        })
        .catch(() => null);
      return;
    }

    if (room.status === 'waiting' && phase === 'lobby') {
      setPhase('waiting');
    }
    if (room.status === 'playing' && phase !== 'playing') {
      setPhase('playing');
    }
    if (['cancelled', 'expired'].includes(room.status) && phase === 'waiting') {
      setError(room.status === 'expired' ? 'That arena room expired.' : 'That arena room was closed by the host.');
      clearActiveRoom(false);
    }
    const myParticipant = (room.arena_participants || []).find((participant: any) => participant.user_id === profile?.id);
    if (myParticipant?.forfeited_at && room.status === 'playing') {
      setError(myParticipant.forfeit_reason === 'inactive'
        ? 'You were away from this Arena match for three minutes and forfeited your place.'
        : 'You forfeited this Arena match.');
      clearActiveRoom(true);
    }
    if (room.status === 'completed') {
      if (parseArenaGameType(room.room_name || '') === 'ludo' && room.completion_reason !== 'forfeit') {
        if (phase !== 'playing') setPhase('playing');
      } else if (phase !== 'finished') {
        setPhase('finished');
        if (profile) window.localStorage.removeItem(activeArenaRoomKey(profile.id));
      }
    }
  }, [activeRoomId, phase, rooms, profile, clearActiveRoom]);

  const forfeitStandardMatch = async () => {
    if (!profile || !activeRoomId || forfeiting) return;
    if (!window.confirm('Forfeit this Arena match? Your stake remains in the prize pool and this cannot be undone.')) return;
    setForfeiting(true);
    try {
      await forfeitArenaGame(activeRoomId, profile.id);
      setError('You forfeited the Arena match.');
      clearActiveRoom(true);
      await load();
      await onBalanceChanged?.();
    } catch (forfeitError: any) {
      setError(forfeitError.message || 'The match could not be forfeited.');
    }
    setForfeiting(false);
  };

  // A player who has joined a live room must enter it on their own device.
  // This keeps every real player responsible for their own turns in Ludo.
  useEffect(() => {
    if (!profile || activeRoomId) return;
    const liveRoom = rooms.find((room) => room.status === 'playing'
      && (room.arena_participants || []).some((participant: any) => (
        participant.user_id === profile.id && !participant.forfeited_at
      )));
    if (liveRoom) activateRoom(liveRoom.id, 'playing');
  }, [activeRoomId, activateRoom, profile, rooms]);

  const createRoom = async () => {
    if (!profile) return;
    setCreating(true);
    setError(null);
    try {
      const topicSuffix = arenaTopicType === 'narrative' || !arenaTopic.trim()
        ? ''
        : ` [${arenaTopicType}: ${arenaTopic.trim()}]`;
      const difficultySuffix = arenaOpponent === 'machine' ? ` [difficulty:${arenaDifficulty}]` : '';
      const fullRoomName = `${roomName}${topicSuffix} [arena:${arenaGameType}]${difficultySuffix}`;
      const roomId = arenaOpponent === 'machine'
        ? await createMachineArenaRoom(profile.id, fullRoomName, selectedNarrativeDate || undefined)
        : await createArenaRoom(profile.id, fullRoomName, stake, maxPlayers, selectedNarrativeDate || undefined, Array.from(taggedIds));
      activateRoom(roomId, 'waiting');
      setShowCreate(false);
      setTaggedIds(new Set());
      setCadetSearch('');
      await load();
      await onBalanceChanged?.();
    } catch (e: any) { setError(e.message || 'Failed to create room'); }
    setCreating(false);
  };

  const joinRoom = async (roomId: string) => {
    if (!profile) return;
    try {
      await joinArenaRoom(roomId, profile.id);
      activateRoom(roomId, 'waiting');
      await load();
      await onBalanceChanged?.();
    } catch (e: any) { setError(e.message || 'Failed to join room'); }
  };

  const startGame = async () => {
    if (!profile || !activeRoomId) return;
    setStarting(true);
    setError(null);
    try {
      await startArenaRoom(activeRoomId, profile.id);
      setPhase('playing');
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to start room');
    }
    setStarting(false);
  };

  const closeRoom = async () => {
    if (!profile || !activeRoomId) return;
    setClosing(true);
    setError(null);
    try {
      await closeArenaRoom(activeRoomId, profile.id);
      clearActiveRoom(true);
      await load();
      await onBalanceChanged?.();
    } catch (e: any) {
      setError(e.message || 'Failed to close room');
    }
    setClosing(false);
  };

  const sendInvites = async () => {
    if (!profile || !activeRoomId || taggedIds.size === 0) return;
    setInviting(true);
    setError(null);
    try {
      const invited = await inviteArenaPlayers(activeRoomId, profile.id, Array.from(taggedIds));
      setTaggedIds(new Set());
      setCadetSearch('');
      await load();
      if (invited === 0) setError('No new cadets were invited.');
    } catch (e: any) {
      setError(e.message || 'Failed to send invites');
    }
    setInviting(false);
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-brass" /></div>;

  if (phase === 'playing' && activeRoomId) {
    const activeRoom = rooms.find((r) => r.id === activeRoomId);
    const activeRoomName = activeRoom?.room_name || roomName;
    if (parseArenaGameType(activeRoomName) === 'ludo') {
      return (
        <RoadHomeGame
          roomId={activeRoomId}
          roomName={activeRoomName}
          userId={profile!.id}
          prepareQuestions={async () => {
            const topic = parseArenaTopic(activeRoomName);
            const narrativeDate = activeRoom?.narrative_date || selectedNarrativeDate;
            const narrative = narrativeDate
              ? narratives.find((item) => item.narrative_date === narrativeDate)
              : narratives[0];
            const generated = await generateArenaQuestionsWithAI({
              roomId: activeRoomId,
              roomName: activeRoomName,
              gameType: 'ludo',
              topicType: topic?.type || 'narrative',
              topic: topic?.value || null,
              narrative: narrative || null,
              difficulty: parseArenaDifficulty(activeRoomName),
            });
            if (!generated.length) throw new Error('The Arena question deck is empty.');
          }}
          onExit={() => clearActiveRoom(true)}
          onStateChanged={async () => {
            await load();
            await onBalanceChanged?.();
          }}
        />
      );
    }
    return (
      <ArenaGamePlay
        narrativeDate={activeRoom?.narrative_date || selectedNarrativeDate}
        roomName={activeRoom?.room_name || roomName}
        narratives={narratives}
        roomId={activeRoomId}
        userId={profile!.id}
        roomQuestionSet={activeRoom?.question_set}
        onComplete={async (score, correctCount) => {
          try {
            await finishArenaGame(activeRoomId, profile!.id, score, correctCount);
          } catch {}
          setPhase('finished');
          await load();
          await onBalanceChanged?.();
        }}
        onForfeit={forfeitStandardMatch}
        forfeiting={forfeiting}
        onExit={() => clearActiveRoom(true)}
      />
    );
  }

  if (phase === 'finished' && activeRoomId) {
    const room = rooms.find((r) => r.id === activeRoomId);
    const winner = room?.winner_id === profile?.id;
    return (
      <div className="max-w-md mx-auto animate-scale-in">
        <div className={cn('card p-8 text-center', winner ? 'border-sage' : 'border-border')}>
          <div className={cn('w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4',
            winner ? 'bg-gold-soft' : 'bg-surface-2')}>
            {winner ? <Trophy size={32} className="text-gold" /> : <Users size={32} className="text-stone" />}
          </div>
          <h2 className="font-display text-2xl font-semibold text-ink mb-2">
            {winner ? 'You Won!' : 'Game Over'}
          </h2>
          <p className="text-stone text-sm mb-4">
            {winner ? `You won ${formatDenarii((room?.stake_amount || 0) * (room?.arena_participants?.length || 1) * 10)} Ð (ten times the total stake).` : room?.completion_reason === 'forfeit' ? 'The match ended by forfeiture.' : 'Better luck next time!'}
          </p>
          <button onClick={() => clearActiveRoom(true)} className="btn-primary w-full">
            Back to Arena
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'waiting' && activeRoomId) {
    const room = rooms.find((r) => r.id === activeRoomId);
    if (!room) {
      return (
        <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
          <button onClick={() => clearActiveRoom(true)} className="btn-ghost text-sm">← Back</button>
          <div className="card p-8 text-center">
            <Loader2 size={24} className="animate-spin text-brass mx-auto mb-3" />
            <p className="text-sm text-stone">Loading arena room...</p>
          </div>
        </div>
      );
    }
    const participants = room?.arena_participants || [];
    const isCreator = room?.creator_id === profile?.id;
    const machineMatch = room?.play_mode === 'machine';
    const canStart = machineMatch || participants.length >= 2;
    const pot = (room?.stake_amount || 0) * participants.length * 10;
    const expiresAt = room?.expires_at ? new Date(room.expires_at).getTime() : null;
    const minutesUntilExpiry = expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000)) : null;
    const availableInviteCadets = allCadets.filter((cadet) => !participants.some((p: any) => p.user_id === cadet.user_id));

    return (
      <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <button onClick={() => clearActiveRoom(true)} className="btn-ghost text-sm">← Back</button>
          <span className="badge badge-gold"><Clock size={12} /> Waiting Room</span>
        </div>

        {error && <div className="p-3 rounded-lg bg-coral-soft text-coral text-sm">{error}</div>}

        <div className="card relative overflow-hidden p-5">
          <PanelImageBackdrop image={arenaImage} opacityFallback={24} veilClassName="bg-navy-2/76" />
          <div className="relative">
          <h3 className="font-display text-lg font-semibold text-ink mb-1">{room?.room_name || 'Arena Room'}</h3>
          <div className="flex items-center gap-3 text-sm text-stone mb-4">
            <span className="flex items-center gap-1"><Coins size={14} className="text-gold" /> {formatDenarii(room?.stake_amount || 0)} Ð stake</span>
            <span className="flex items-center gap-1"><Users size={14} /> {participants.length}/{room?.max_players || 4}</span>
            <span className="flex items-center gap-1"><Trophy size={14} className="text-gold" /> {formatDenarii(pot)} Ð pot</span>
            {minutesUntilExpiry !== null && participants.length <= 1 && (
              <span className="flex items-center gap-1"><Clock size={14} /> closes in {minutesUntilExpiry}m</span>
            )}
          </div>
          <p className="text-xs text-stone mb-4">
            {machineMatch ? `Machine target: ${room?.machine_score || 10} figs. Win to receive ten times your 50 denarii stake.` : 'The stake stays locked in this room. Signing out does not close it; only the host can close it, or it expires after six hours if no one else joins.'}
          </p>

          <div className="space-y-2 mb-4">
            {participants.map((p: any) => (
              <div key={p.user_id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-2">
                <div className="w-8 h-8 rounded-full bg-gold-soft overflow-hidden flex items-center justify-center font-display font-bold text-sm text-gold">
                  {p.profiles?.avatar_url ? <img src={p.profiles.avatar_url} alt={p.profiles?.display_name || ''} className="w-full h-full object-cover" /> : (p.profiles?.display_name?.charAt(0) || '?')}
                </div>
                <span className="text-sm text-ink">{p.profiles?.display_name || 'Unknown'}</span>
                {p.user_id === room?.creator_id && <span className="badge badge-brass text-[9px]">Host</span>}
                {p.stake_paid && <CheckCircle2 size={14} className="text-sage" />}
              </div>
            ))}
          </div>

          {!machineMatch && <ArenaWaitingChat roomId={room.id} userId={profile!.id} />}

          {isCreator && !machineMatch && (
            <div className="p-3 rounded-lg border border-border bg-surface-2 mb-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-xs font-display font-semibold text-ink">Invite Cadets</h4>
                <span className="text-[10px] text-stone">Only the host can invite or close</span>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone" />
                <input className="input-field pl-9 text-sm" placeholder="Search cadets..." value={cadetSearch} onChange={(e) => setCadetSearch(e.target.value)} />
              </div>
              {taggedIds.size > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Array.from(taggedIds).map((id) => {
                    const cadet = allCadets.find((c) => c.user_id === id);
                    return (
                      <span key={id} className="badge badge-gold text-[10px] flex items-center gap-1">
                        {cadet?.profiles?.display_name || 'Unknown'}
                        <button onClick={() => { setTaggedIds((prev) => { const n = new Set(prev); n.delete(id); return n; }); }} className="hover:text-coral">×</button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="max-h-32 overflow-y-auto space-y-1">
                {availableInviteCadets
                  .filter((cadet) => !cadetSearch || cadet.profiles?.display_name?.toLowerCase().includes(cadetSearch.toLowerCase()))
                  .slice(0, 12)
                  .map((cadet) => {
                    const checked = taggedIds.has(cadet.user_id);
                    return (
                      <label key={cadet.user_id} className={cn('flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors', checked ? 'bg-gold-soft' : 'hover:bg-surface-3')}>
                        <input type="checkbox" checked={checked} onChange={() => {
                          setTaggedIds((prev) => {
                            const n = new Set(prev);
                            if (n.has(cadet.user_id)) n.delete(cadet.user_id);
                            else n.add(cadet.user_id);
                            return n;
                          });
                        }} className="accent-gold flex-shrink-0" />
                        <span className="text-sm text-ink truncate">{cadet.profiles?.display_name || 'Unknown'}</span>
                      </label>
                    );
                  })}
                {availableInviteCadets.length === 0 && <p className="text-xs text-stone text-center py-2">No more cadets available to invite.</p>}
              </div>
              <button onClick={sendInvites} disabled={inviting || taggedIds.size === 0} className="btn-secondary text-xs w-full disabled:opacity-50">
                {inviting ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                Send Invites
              </button>
            </div>
          )}

          {isCreator ? (
            <div className="grid sm:grid-cols-2 gap-2">
              <button onClick={startGame} disabled={!canStart || starting} className="btn-primary w-full disabled:opacity-50">
                {starting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {canStart ? 'Start Game' : 'Waiting for players...'}
              </button>
              <button onClick={closeRoom} disabled={closing} className="btn-secondary w-full text-coral disabled:opacity-50">
                {closing ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
                Close Room
              </button>
            </div>
          ) : (
            <p className="text-xs text-stone text-center">Waiting for the host to start the game...</p>
          )}
          </div>
        </div>
      </div>
    );
  }

  // Lobby
  return (
    <div className="space-y-5 animate-fade-in max-w-3xl mx-auto">
      <div className="card relative overflow-hidden p-4 sm:p-5">
        <PanelImageBackdrop image={arenaImage} opacityFallback={22} veilClassName="bg-navy-2/78" />
        <div className="relative">
          <SectionHeader title="The Arena" subtitle="Challenge other cadets to real-time quiz battles. Stake denarii, winner takes all." />
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2">
          <Coins size={20} className="text-gold" />
          <div>
            <p className="eyebrow text-stone">Available Denarii</p>
            <span className="font-display font-bold text-gold text-xl">{formatDenarii(denarii)} Ð</span>
          </div>
        </div>
      </div>

      <div className="card p-4 sm:p-5">
        <p className="eyebrow text-stone">Arena Match</p>
        <h3 className="mt-1 font-display text-base font-semibold text-ink">Choose your battle, then create one room.</h3>
        <p className="mt-1 text-xs leading-relaxed text-stone">Play the machine or invite people. Both use the same match setup and the same tenfold prize rule.</p>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary mt-4 w-full sm:w-auto text-sm">
          <Plus size={14} /> {showCreate ? 'Close Match Setup' : 'Create Arena Match'}
        </button>
      </div>

      {error && <div className="p-3 rounded-lg bg-coral-soft text-coral text-sm">{error}</div>}

      {showCreate && (
        <div className="card p-5 space-y-3 animate-slide-up">
          <h4 className="font-display font-semibold text-ink">Create Arena Match</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-stone block mb-1">Opponent</label>
              <select className="input-field" value={arenaOpponent} onChange={(event) => setArenaOpponent(event.target.value as 'players' | 'machine')}>
                <option value="players">Other players</option>
                <option value="machine">Machine</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-stone block mb-1">Game Play</label>
              <select className="input-field" value={arenaGameType} onChange={(event) => setArenaGameType(event.target.value as 'standard' | 'ludo')}>
                <option value="standard">Standard Trivia</option>
                <option value="ludo">Ludo Trivia</option>
              </select>
            </div>
          </div>
          {arenaOpponent === 'machine' && <div>
            <label className="text-xs text-stone block mb-1">Machine Difficulty</label>
            <select className="input-field" value={arenaDifficulty} onChange={(event) => setArenaDifficulty(event.target.value as 'easy' | 'medium' | 'hard')}>
              <option value="easy">Easy · slower and less accurate</option>
              <option value="medium">Medium · balanced</option>
              <option value="hard">Hard · fast and highly accurate</option>
            </select>
          </div>}
          <p className="rounded-lg border border-brass/25 bg-brass-soft p-3 text-xs text-stone">
            {arenaGameType === 'standard' ? 'Standard Trivia: answer random Bible narrative questions; the highest score wins.' : 'Ludo Trivia: correct answers move tokens around the board, with surprise spaces and relic effects.'}
            {arenaOpponent === 'machine' && ' Machine matches cost a fixed 50 Ð.'}
          </p>
          <div>
            <label className="text-xs text-stone block mb-1">Room Name</label>
            <input className="input-field" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
          </div>
          <div className={cn('grid gap-3', arenaOpponent === 'machine' ? 'grid-cols-1' : 'grid-cols-2')}>
            <div>
              <label className="text-xs text-stone block mb-1">Stake (denarii)</label>
              <input type="number" className="input-field" value={arenaOpponent === 'machine' ? 50 : stake} min={10} disabled={arenaOpponent === 'machine'} onChange={(e) => setStake(parseInt(e.target.value) || 0)} />
            </div>
            {arenaOpponent === 'players' && <div>
              <label className="text-xs text-stone block mb-1">Other Players <span className="text-stone/60">(you are already included)</span></label>
              <input type="number" className="input-field" value={maxPlayers - 1} min={1} max={arenaGameType === 'ludo' ? 3 : 7} onChange={(e) => {
                const opponents = Math.max(1, Math.min(arenaGameType === 'ludo' ? 3 : 7, parseInt(e.target.value) || 1));
                setMaxPlayers(opponents + 1);
                setTaggedIds((current) => new Set(Array.from(current).slice(0, opponents)));
              }} />
            </div>}
          </div>
          {arenaOpponent === 'players' && <>
          <div>
            <label className="text-xs text-stone block mb-1">Content Source (narrative date)</label>
            <select className="input-field" value={selectedNarrativeDate} onChange={(e) => setSelectedNarrativeDate(e.target.value)}>
              <option value="">Any / Latest</option>
              {narratives.map((n) => (
                <option key={n.narrative_date} value={n.narrative_date}>{n.narrative_date}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-stone block mb-1">Arena Question Focus</label>
              <select className="input-field" value={arenaTopicType} onChange={(e) => setArenaTopicType(e.target.value as any)}>
                <option value="narrative">Narrative packet</option>
                <option value="book">Book of the Bible</option>
                <option value="character">Bible character</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-stone block mb-1">Book / Character</label>
              <input
                className="input-field"
                disabled={arenaTopicType === 'narrative'}
                placeholder={arenaTopicType === 'book' ? 'Romans' : arenaTopicType === 'character' ? 'David' : 'Uses packet'}
                value={arenaTopic}
                onChange={(e) => setArenaTopic(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-stone block mb-1.5">Tag Cadets <span className="text-stone/60">({taggedIds.size}/{maxPlayers - 1} spaces — they still choose whether to join)</span></label>
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone" />
              <input className="input-field pl-9 text-sm" placeholder="Search cadets across tents..." value={cadetSearch} onChange={(e) => setCadetSearch(e.target.value)} />
            </div>
            {taggedIds.size > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {Array.from(taggedIds).map((id) => {
                  const cadet = allCadets.find((c) => c.user_id === id);
                  return (
                    <span key={id} className="badge badge-gold text-[10px] flex items-center gap-1">
                      {cadet?.profiles?.display_name || 'Unknown'}
                      <button onClick={() => { setTaggedIds((prev) => { const n = new Set(prev); n.delete(id); return n; }); }} className="hover:text-coral">×</button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-border bg-surface-2 p-2">
              {allCadets
                .filter((c) => !cadetSearch || c.profiles?.display_name?.toLowerCase().includes(cadetSearch.toLowerCase()))
                .slice(0, 20)
                .map((cadet) => {
                  const checked = taggedIds.has(cadet.user_id);
                  const full = !checked && taggedIds.size >= maxPlayers - 1;
                  return (
                    <label key={cadet.user_id} className={cn('flex items-center gap-2 p-2 rounded-md transition-colors', full ? 'cursor-not-allowed opacity-45' : 'cursor-pointer', checked ? 'bg-gold-soft' : 'hover:bg-surface-3')}>
                      <input type="checkbox" checked={checked} disabled={full} onChange={() => {
                        setTaggedIds((prev) => {
                          const n = new Set(prev);
                          if (n.has(cadet.user_id)) n.delete(cadet.user_id);
                          else n.add(cadet.user_id);
                          return n;
                        });
                      }} className="accent-gold flex-shrink-0" />
                      <div className="w-6 h-6 rounded-full bg-gold-soft overflow-hidden flex items-center justify-center font-display font-bold text-[10px] text-gold flex-shrink-0">
                        {cadet.profiles?.avatar_url ? <img src={cadet.profiles.avatar_url} alt={cadet.profiles?.display_name || ''} className="w-full h-full object-cover" /> : (cadet.profiles?.display_name?.charAt(0) || '?')}
                      </div>
                      <span className="text-sm text-ink truncate flex-1">{cadet.profiles?.display_name || 'Unknown'}</span>
                    </label>
                  );
                })}
              {allCadets.length === 0 && <p className="text-xs text-stone text-center py-2">No other cadets available.</p>}
            </div>
          </div>
          </>}
          <button onClick={createRoom} disabled={creating || (arenaOpponent === 'machine' ? denarii < 50 : stake < 10 || stake + ARENA_GAME_CALL_FEE > denarii)} className="btn-primary text-sm">
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Swords size={14} />} {arenaOpponent === 'machine' ? 'Create Machine Match · 50 Ð' : `Create & Stake ${formatDenarii(stake)} Ð`}
          </button>
          {arenaOpponent === 'machine' ? <p className="text-xs text-stone">Machine matches charge only the fixed 50 Ð stake.</p> : <>
            {stake + ARENA_GAME_CALL_FEE > denarii && <p className="text-xs text-coral">Insufficient denarii. You need {formatDenarii(stake + ARENA_GAME_CALL_FEE)} Ð (stake + {ARENA_GAME_CALL_FEE} game call fee).</p>}
            {stake + ARENA_GAME_CALL_FEE <= denarii && <p className="text-xs text-stone">A {ARENA_GAME_CALL_FEE} Ð game call fee is charged in addition to the stake.</p>}
          </>}
        </div>
      )}

      <div className="space-y-2">
        <h4 className="font-display font-semibold text-ink text-sm">Open Rooms</h4>
        {rooms.filter((r) => r.status === 'waiting').length === 0 ? (
          <EmptyState icon={(props) => <Swords {...props} />} title="No open rooms" message="Create a room and invite other cadets to battle." />
        ) : (
          rooms.filter((r) => r.status === 'waiting').map((room) => {
            const participants = room.arena_participants || [];
            const isParticipant = participants.some((p: any) => p.user_id === profile?.id);
            const host = participants.find((p: any) => p.user_id === room.creator_id)?.profiles;
            const invited = Array.isArray(room.tagged_user_ids) && profile?.id ? room.tagged_user_ids.includes(profile.id) : false;
            const expiresAt = room.expires_at ? new Date(room.expires_at).getTime() : null;
            const minutesUntilExpiry = expiresAt && participants.length <= 1 ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000)) : null;
            const pot = room.stake_amount * participants.length * 10;
            return (
              <div key={room.id} className="card relative overflow-hidden p-4 flex items-center gap-3">
                <PanelImageBackdrop image={arenaImage} opacityFallback={18} veilClassName="bg-navy-2/80" />
                <div className="w-10 h-10 rounded-lg bg-gold-soft flex items-center justify-center flex-shrink-0">
                  <Swords size={20} className="text-gold" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{room.room_name}</p>
                    {room.creator_id === profile?.id && <span className="badge badge-brass text-[9px]">Host</span>}
                    {invited && !isParticipant && <span className="badge badge-gold text-[9px]">Invited</span>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-stone">
                    <span className="flex items-center gap-0.5"><Coins size={11} /> {formatDenarii(room.stake_amount)} Ð</span>
                    <span className="flex items-center gap-0.5"><Trophy size={11} /> {formatDenarii(pot)} Ð pot</span>
                    <span className="flex items-center gap-0.5"><Users size={11} /> {participants.length}/{room.max_players}</span>
                    {host?.display_name && <span className="truncate">Host: {host.display_name}</span>}
                    {minutesUntilExpiry !== null && <span>{minutesUntilExpiry}m left</span>}
                  </div>
                </div>
                {isParticipant ? (
                  <button onClick={() => activateRoom(room.id, 'waiting')} className="btn-secondary text-xs">
                    Enter Room
                  </button>
                ) : (
                  <button onClick={() => joinRoom(room.id)} disabled={denarii < room.stake_amount || participants.length >= room.max_players}
                    className="btn-primary text-xs disabled:opacity-40">
                    {invited ? 'Join Invite' : `Join (${formatDenarii(room.stake_amount)} Ð)`}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {rooms.filter((r) => r.status === 'completed').length > 0 && (
        <div className="space-y-2">
          <h4 className="font-display font-semibold text-ink text-sm">Recent Games</h4>
          {rooms.filter((r) => r.status === 'completed').slice(0, 5).map((room) => {
            const participants = room.arena_participants || [];
            const winner = participants.find((p: any) => p.user_id === room.winner_id);
            return (
              <div key={room.id} className="card bg-surface/70 backdrop-blur-sm p-3 flex items-center gap-3 opacity-75">
                <Trophy size={16} className="text-gold flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-ink">{room.room_name}</p>
                  <p className="text-xs text-stone">Winner: {winner?.profiles?.display_name || '—'} · Prize: {formatDenarii(room.stake_amount * participants.length * 10)} Ð</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function parseArenaTopic(roomName: string) {
  const match = roomName.match(/\[(book|character):\s*([^\]]+)\]/i);
  return match ? { type: match[1].toLowerCase(), value: match[2].trim() } : null;
}

function parseArenaGameType(roomName: string) {
  return /\[arena:ludo\]/i.test(roomName) ? 'ludo' : 'standard';
}

function parseArenaDifficulty(roomName: string): 'easy' | 'medium' | 'hard' {
  const match = roomName.match(/\[difficulty:(easy|medium|hard)\]/i);
  return (match?.[1]?.toLowerCase() as 'easy' | 'medium' | 'hard') || 'medium';
}

function ArenaWaitingChat({ roomId, userId }: { roomId: string; userId: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const loadMessages = useCallback(async () => {
    try { setMessages(await fetchArenaRoomMessages(roomId)); } catch (error) { console.error('Arena chat load failed', error); }
  }, [roomId]);

  useEffect(() => {
    void loadMessages();
    const channel = supabase.channel(`arena-room-chat-${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'arena_room_messages', filter: `room_id=eq.${roomId}` }, () => void loadMessages())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [roomId, loadMessages]);

  const send = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    try { await sendArenaRoomMessage(roomId, userId, body); setBody(''); await loadMessages(); } catch (error) { console.error('Arena chat send failed', error); }
    setSending(false);
  };

  return (
    <div className="mb-4 rounded-lg border border-border bg-surface/80 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink"><MessageCircle size={14} className="text-brass" /> Room chat</div>
      <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 ? <p className="py-3 text-center text-xs text-stone">Talk while the room fills.</p> : messages.map((message) => {
          const mine = message.sender_id === userId;
          return <div key={message.id} className={cn('flex gap-2', mine ? 'justify-end' : 'justify-start')}>
            {!mine && <div className="mt-0.5 h-6 w-6 overflow-hidden rounded-full bg-gold-soft text-center text-[10px] leading-6 text-gold">{message.sender?.avatar_url ? <img src={message.sender.avatar_url} alt="" className="h-full w-full object-cover" /> : message.sender?.display_name?.charAt(0) || '?'}</div>}
            <p className={cn('max-w-[80%] rounded-lg px-2.5 py-1.5 text-xs', mine ? 'bg-brass/15 text-ink' : 'bg-surface-2 text-ink')}><span className="mr-1 font-semibold">{mine ? 'You' : message.sender?.display_name || 'Cadet'}</span>{message.body}</p>
          </div>;
        })}</div>
      <div className="mt-3 flex gap-2"><input value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void send(); } }} className="input-field min-w-0 flex-1 text-sm" placeholder="Write a message..." /><button type="button" onClick={() => void send()} disabled={!body.trim() || sending} className="btn-primary px-3" aria-label="Send room message">{sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}</button></div>
    </div>
  );
}

const ARENA_ROUND_LENGTHS = [6, 6, 6, 1];
function getArenaQuestionSeconds(question: QuestionPayload | undefined) {
  if (question?.difficulty_tag === 'easy') return 40;
  if (question?.difficulty_tag === 'hard') return 15;
  return 25;
}

function getArenaRoundForIndex(questionIndex: number) {
  let start = 0;
  for (let roundIndex = 0; roundIndex < ARENA_ROUND_LENGTHS.length; roundIndex += 1) {
    const end = start + ARENA_ROUND_LENGTHS[roundIndex];
    if (questionIndex < end) return roundIndex;
    start = end;
  }
  return ARENA_ROUND_LENGTHS.length - 1;
}

function ArenaGamePlay({ narrativeDate, roomName, narratives, roomId, userId, roomQuestionSet, onComplete, onForfeit, forfeiting, onExit }: {
  narrativeDate: string;
  roomName: string;
  narratives: DailyNarrative[];
  roomId: string;
  userId: string;
  roomQuestionSet?: QuestionPayload[] | null;
  onComplete: (score: number, correctCount: number) => void;
  onForfeit: () => void;
  forfeiting: boolean;
  onExit: () => void;
}) {
  const { profile } = useAuth();
  const [questions, setQuestions] = useState<QuestionPayload[]>([]);
  const [answerFeed, setAnswerFeed] = useState<ArenaTriviaFeedItem[]>([]);
  const [machineAnswerFeed, setMachineAnswerFeed] = useState<ArenaTriviaFeedItem[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [answeredIds, setAnsweredIds] = useState<Set<number>>(new Set());
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [machineScore, setMachineScore] = useState(0);
  const [turnPhase, setTurnPhase] = useState<'user' | 'user-feedback' | 'machine-thinking' | 'machine-feedback'>('user');
  const [answerFeedback, setAnswerFeedback] = useState<{ correct: boolean; answer: string } | null>(null);
  const [matchPlayers, setMatchPlayers] = useState<{ user_id: string; display_name: string; avatar_url: string | null }[]>([]);
  const [timeLeft, setTimeLeft] = useState(40);
  const [ready, setReady] = useState(false);
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scoreRef = useRef(0);
  const correctCountRef = useRef(0);
  const completedRef = useRef(false);
  const activeRoundIndex = getArenaRoundForIndex(currentQ);
  const machineMatch = /\[difficulty:(easy|medium|hard)\]/i.test(roomName);
  const machineDifficulty = parseArenaDifficulty(roomName);
  const activeRealPlayer = !machineMatch && matchPlayers.length > 0 ? matchPlayers[currentQ % matchPlayers.length] : null;
  const isMyTurn = machineMatch || !activeRealPlayer || activeRealPlayer.user_id === userId;

  useEffect(() => { scoreRef.current = score; }, [score]);
  useEffect(() => { correctCountRef.current = correctCount; }, [correctCount]);

  const refreshAnswerFeed = useCallback(async () => {
    try { setAnswerFeed(await fetchArenaTriviaFeed(roomId)); } catch { /* The room may be settling between states. */ }
  }, [roomId]);

  useEffect(() => {
    void refreshAnswerFeed();
    const interval = window.setInterval(() => { void refreshAnswerFeed(); }, 1200);
    return () => window.clearInterval(interval);
  }, [refreshAnswerFeed]);

  useEffect(() => {
    if (machineMatch) return;
    let cancelled = false;
    void (async () => {
      const { data: rows } = await supabase.from('arena_participants').select('user_id,joined_at').eq('room_id', roomId).is('forfeited_at', null).order('joined_at');
      const ids = (rows || []).map((row) => row.user_id);
      const { data: profiles } = ids.length ? await supabase.from('profiles').select('id,display_name,avatar_url').in('id', ids) : { data: [] as any[] };
      const byId = new Map((profiles || []).map((item) => [item.id, item]));
      if (!cancelled) setMatchPlayers(ids.map((id) => ({ user_id: id, display_name: byId.get(id)?.display_name || 'Arena player', avatar_url: byId.get(id)?.avatar_url || null })));
    })();
    return () => { cancelled = true; };
  }, [machineMatch, roomId]);

  useEffect(() => {
    if (ready && questions.length > 0) void playSoundEffect('sound_arena_round', 0.62);
  }, [activeRoundIndex, questions.length, ready]);

  const completeGame = useCallback((finalScore = scoreRef.current, finalCorrectCount = correctCountRef.current) => {
    if (completedRef.current) return;
    completedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    onComplete(finalScore, finalCorrectCount);
  }, [onComplete]);

  useEffect(() => {
    if (machineMatch || !ready || questions.length === 0 || matchPlayers.length === 0) return;
    const nextIndex = Math.min(answerFeed.length, questions.length);
    if (nextIndex >= questions.length) {
      completeGame(scoreRef.current, correctCountRef.current);
      return;
    }
    setCurrentQ(nextIndex);
    setTypedAnswer('');
    setAnswerFeedback(null);
    setTurnPhase(matchPlayers[nextIndex % matchPlayers.length]?.user_id === userId ? 'user' : 'machine-thinking');
  }, [answerFeed.length, machineMatch, matchPlayers, questions.length, ready, userId, completeGame]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (Array.isArray(roomQuestionSet) && roomQuestionSet.length >= 19) {
        setQuestions(roomQuestionSet);
        setReady(true);
        return;
      }
      const topic = parseArenaTopic(roomName);
      const narrative = narrativeDate
        ? narratives.find((n) => n.narrative_date === narrativeDate)
        : narratives[0];
      try {
        const difficulty = parseArenaDifficulty(roomName);
        const aiQuestions = await generateArenaQuestionsWithAI({
          roomId,
          roomName,
          gameType: parseArenaGameType(roomName),
          topicType: topic?.type || 'narrative',
          topic: topic?.value || null,
          narrative: narrative || null,
          difficulty,
        });
        if (!cancelled) {
          setQuestions(aiQuestions);
          setReady(true);
        }
        return;
      } catch (e) {
        console.error('AI Arena generation failed.', e);
        if (!cancelled) {
          setAnswerError(e instanceof Error ? e.message : 'The Arena could not prepare its questions.');
          setReady(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [narrativeDate, narratives, roomId, roomName, roomQuestionSet, userId]);

  const handleAnswer = useCallback(async (answer: string | null) => {
    if (answeredIds.has(currentQ) || !questions[currentQ] || turnPhase !== 'user' || !isMyTurn) return;
    setSubmittingAnswer(true);
    setAnswerError(null);
    let result: {
      correct: boolean;
      totalFigs: number;
      correctCount: number;
      machineQuestionIndex: number | null;
      machineAnswer: string | null;
      machineCorrect: boolean | null;
      machineFigs: number;
      machineTotalFigs: number;
    };
    try {
      result = await submitArenaTriviaAnswer(roomId, userId, currentQ, answer);
    } catch (error: any) {
      console.error('Arena answer verification failed', error);
      setAnswerError(error?.message || 'That answer could not be submitted. Please try again.');
      setSubmittingAnswer(false);
      return;
    }
    const nextScore = result.totalFigs;
    const nextCorrectCount = result.correctCount;
    setAnsweredIds((prev) => {
      const next = new Set(prev);
      next.add(currentQ);
      return next;
    });
    setScore(nextScore);
    setCorrectCount(nextCorrectCount);
    setAnswerFeedback({ correct: result.correct, answer: answer || 'No answer' });
    setTurnPhase('user-feedback');
    void refreshAnswerFeed();
    setSubmittingAnswer(false);

    const advance = (finalMachineScore: number, questionsAdvanced = 1) => {
      const nextIndex = currentQ + questionsAdvanced;
      if (nextIndex >= questions.length) {
        setMachineScore(finalMachineScore);
        completeGame(nextScore, nextCorrectCount);
        return;
      }
      setCurrentQ(nextIndex);
      setTypedAnswer('');
      setAnswerFeedback(null);
      setTurnPhase('user');
    };

    await new Promise<void>((resolve) => window.setTimeout(resolve, 900));
    if (!machineMatch) {
      setTurnPhase('machine-thinking');
      await refreshAnswerFeed();
      return;
    }

    const machineQuestionIndex = result.machineQuestionIndex;
    if (machineQuestionIndex == null) {
      completeGame(nextScore, nextCorrectCount);
      return;
    }
    if (machineQuestionIndex >= questions.length) {
      completeGame(nextScore, nextCorrectCount);
      return;
    }
    setTurnPhase('machine-thinking');
    const delay = machineDifficulty === 'easy' ? 2600 : machineDifficulty === 'hard' ? 1250 : 1850;
    await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
    const machineCorrect = Boolean(result.machineCorrect);
    const selected = result.machineAnswer || 'No answer';
    const earned = result.machineFigs;
    const nextMachineScore = result.machineTotalFigs;
    setMachineScore(nextMachineScore);
    setMachineAnswerFeed((current) => [...current, {
      user_id: 'arena-machine',
      display_name: `The Scribe · ${machineDifficulty.charAt(0).toUpperCase()}${machineDifficulty.slice(1)}`,
      avatar_url: null,
      question_index: machineQuestionIndex,
      submitted_answer: selected,
      is_correct: machineCorrect,
      figs_earned: earned,
      created_at: new Date().toISOString(),
    }]);
    setTurnPhase('machine-feedback');
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1100));
    advance(nextMachineScore, 2);
  }, [answeredIds, questions, currentQ, turnPhase, isMyTurn, refreshAnswerFeed, roomId, userId, machineMatch, machineDifficulty, completeGame]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const activeQuestion = questions[currentQ];
    if (!ready || !activeQuestion) return;
    if (answeredIds.has(currentQ) || turnPhase !== 'user' || !isMyTurn) return;

    const seconds = getArenaQuestionSeconds(activeQuestion);
    const deadline = Date.now() + seconds * 1000;
    setTimeLeft(seconds);
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining > 0) return;
      if (timerRef.current) clearInterval(timerRef.current);
      if (currentQ + 1 >= questions.length) {
        void handleAnswer(null);
      } else {
        void handleAnswer(null);
      }
    }, 250);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [ready, questions, currentQ, answeredIds, completeGame, handleAnswer, turnPhase, isMyTurn]);

  const moveToNextRound = () => {
    const nextRoundQuestionIndex = ARENA_ROUND_LENGTHS
      .slice(0, activeRoundIndex + 1)
      .reduce((sum, length) => sum + length, 0);
    if (nextRoundQuestionIndex < questions.length) {
      setCurrentQ(nextRoundQuestionIndex);
      setTypedAnswer('');
    } else {
      completeGame();
    }
  };

  if (!ready) return <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-brass" /></div>;

  if (questions.length === 0) {
    return (
      <div className="text-center py-8 space-y-4">
        <p className="text-stone">{answerError || 'No verified questions are available for this Arena game.'}</p>
        <button onClick={onExit} className="btn-primary">Back to Arena</button>
      </div>
    );
  }

  const q = questions[currentQ];
  const currentRound = getArenaRoundForIndex(currentQ);
  const roundQuestionStart = ARENA_ROUND_LENGTHS.slice(0, currentRound).reduce((sum, length) => sum + length, 0);
  const roundQuestionNumber = currentQ - roundQuestionStart + 1;
  const isCurrentAnswered = answeredIds.has(currentQ);
  const nextQuestionWouldStartNewRound = getArenaRoundForIndex(currentQ + 1) !== currentRound;
  const waitingForNextRound = isCurrentAnswered && nextQuestionWouldStartNewRound && currentQ + 1 < questions.length;
  const visibleAnswerFeed = [...answerFeed, ...machineAnswerFeed].sort((left, right) => left.created_at.localeCompare(right.created_at));
  const latestMachineAnswer = machineAnswerFeed[machineAnswerFeed.length - 1];
  const opponentScores = Array.from(answerFeed.reduce((scores, item) => {
    if (item.user_id === userId) return scores;
    const current = scores.get(item.user_id) || { name: item.display_name, figs: 0 };
    current.figs += item.figs_earned;
    scores.set(item.user_id, current);
    return scores;
  }, new Map<string, { name: string; figs: number }>()).values());

  return (
    <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <button onClick={onForfeit} disabled={forfeiting} className="btn-ghost text-sm text-coral disabled:opacity-50">
          {forfeiting ? <Loader2 size={14} className="animate-spin" /> : <Flag size={14} />} Forfeit
        </button>
        <span className="badge badge-gold"><Zap size={12} /> Arena Battle</span>
        <div className={cn(
          'px-3 py-1.5 rounded-lg font-display font-semibold text-sm flex items-center gap-1.5',
          timeLeft <= 10 ? 'bg-coral-soft text-coral' : 'bg-gold-soft text-gold',
        )}>
          <Clock size={14} /> {timeLeft}s
        </div>
      </div>

      <div className="flex gap-1.5">
        {ARENA_ROUND_LENGTHS.map((_, i) => (
          <div key={i} className={cn(
            'h-1.5 flex-1 rounded-full transition-colors',
            i < currentRound ? 'bg-sage' : i === currentRound ? 'bg-gold' : 'bg-surface-2',
          )} />
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-stone">
        <span>Live score: <span className="text-ink font-semibold">You {score}</span>{machineMatch ? ` · The Scribe ${machineScore}` : opponentScores.map((opponent) => ` · ${opponent.name} ${opponent.figs}`).join('')}</span>
        <span>Round {currentRound + 1}: <span className="text-ink font-semibold">{roundQuestionNumber}</span> / {ARENA_ROUND_LENGTHS[currentRound]} · {q.difficulty_tag === 'moderate' ? 'Medium' : q.difficulty_tag === 'hard' ? 'Hard' : 'Easy'}</span>
      </div>

      {machineMatch && turnPhase.startsWith('machine') && (
        <div className={cn('card border-2 p-4 transition-all', turnPhase === 'machine-thinking' ? 'border-gold/45' : latestMachineAnswer?.is_correct ? 'border-sage/45' : 'border-coral/45')}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold-soft"><Zap size={20} className="text-gold" /></div>
            <div className="min-w-0 flex-1"><p className="text-sm font-bold text-ink">The Scribe’s turn</p><p className="text-xs text-stone">{turnPhase === 'machine-thinking' ? 'Reading the question and choosing…' : latestMachineAnswer?.is_correct ? 'Right answer' : 'Wrong answer'}</p></div>
            {turnPhase === 'machine-thinking' && <Loader2 size={18} className="animate-spin text-gold" />}
          </div>
          <p className="mt-3 text-sm font-semibold text-ink">{questions[currentQ + 1]?.question}</p>
          {turnPhase === 'machine-feedback' && <p className="mt-2 text-sm text-stone">Selected: <span className="font-bold text-ink">{latestMachineAnswer?.submitted_answer}</span></p>}
        </div>
      )}

      {!machineMatch && activeRealPlayer && !isMyTurn && (
        <div className="card border-2 border-royal/45 p-4 transition-all">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-royal-soft font-bold text-royal">{activeRealPlayer.avatar_url ? <img src={activeRealPlayer.avatar_url} alt="" className="h-full w-full object-cover" /> : activeRealPlayer.display_name.charAt(0)}</div>
            <div className="min-w-0 flex-1"><p className="text-sm font-bold text-ink">{activeRealPlayer.display_name}’s turn</p><p className="text-xs text-stone">Their question, answer, and outcome are visible to everyone.</p></div>
            <Loader2 size={18} className="animate-spin text-royal" />
          </div>
          <p className="mt-3 text-sm font-semibold text-ink">{q.question}</p>
        </div>
      )}

      <div className="card p-5">
        {answerError && <div className="mb-4 rounded-lg border border-coral/35 bg-coral-soft px-3 py-2 text-sm text-coral" role="alert">{answerError}</div>}
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-gold bg-surface-2 text-sm font-bold text-ink">{profile?.avatar_url ? <img src={profile.avatar_url} alt={profile.display_name} className="h-full w-full object-cover" /> : profile?.display_name?.charAt(0) || 'Y'}</div>
          <div><p className="text-xs font-bold text-ink">{isMyTurn ? profile?.display_name || 'Your question' : activeRealPlayer?.display_name || 'Opponent question'}</p><p className="eyebrow mt-0.5">{q.is_bonus ? 'Bonus · 2 figs · 15 seconds' : `Round ${currentRound + 1} · Question ${roundQuestionNumber} · ${getArenaQuestionSeconds(q)} seconds`}</p></div>
        </div>
        <h3 className="font-display font-medium text-ink text-lg mb-4">{q.question}</h3>
        {answerFeedback && (
          <div className={cn('mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold', answerFeedback.correct ? 'border-sage/40 bg-sage-soft text-sage' : 'border-coral/40 bg-coral-soft text-coral')}>
            {answerFeedback.correct ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            {answerFeedback.correct ? 'Right answer' : 'Wrong answer'}
          </div>
        )}

        {/* True/False */}
        {q.type === 'true_false' && (
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => void handleAnswer('True')} disabled={isCurrentAnswered || submittingAnswer || turnPhase !== 'user' || !isMyTurn}
              className={cn('py-4 rounded-lg border-2 font-display font-bold text-lg transition-all',
                'border-sage hover:bg-sage-soft text-sage')}>
              <CheckCircle2 size={24} className="mx-auto mb-1" /> True
            </button>
            <button onClick={() => void handleAnswer('False')} disabled={isCurrentAnswered || submittingAnswer || turnPhase !== 'user' || !isMyTurn}
              className={cn('py-4 rounded-lg border-2 font-display font-bold text-lg transition-all',
                'border-coral hover:bg-coral-soft text-coral')}>
              <XCircle size={24} className="mx-auto mb-1" /> False
            </button>
          </div>
        )}

        {/* Multiple choice / comprehension */}
        {(q.type === 'multiple_choice' || q.type === 'true_false') && q.options && q.type !== 'true_false' && (
          <div className="space-y-2">
            {q.options.map((opt, i) => {
              return (
                <button key={i} onClick={() => void handleAnswer(opt)} disabled={isCurrentAnswered || submittingAnswer || turnPhase !== 'user' || !isMyTurn}
                  className={cn('w-full text-left p-3.5 rounded-lg border transition-all text-sm font-medium',
                    'border-border hover:border-gold text-ink')}>
                  {opt}
                </button>
              );
            })}
          </div>
        )}

        {/* Other types — simplified for arena (just show as multiple choice) */}
        {(q.type === 'cloze' || q.type === 'scriptorium' || q.type === 'order_sequence' || q.type === 'matching' || q.type === 'standard_text') && (
          <div className="space-y-2">
            <input className="input-field" placeholder="Type your answer..." autoFocus
              value={typedAnswer}
              onChange={(e) => setTypedAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = typedAnswer.trim();
                  if (v) void handleAnswer(v);
                }
              }} />
            <button className="btn-primary w-full" onClick={() => {
              const v = typedAnswer.trim();
              if (v) void handleAnswer(v);
            }} disabled={!typedAnswer.trim() || isCurrentAnswered || submittingAnswer}>Submit</button>
          </div>
        )}
        {waitingForNextRound && (
          <div className="mt-4 rounded-lg border border-brass/30 bg-brass/10 p-3 text-sm text-stone">
            <p className="mb-3">Round complete. You can move into the next round immediately.</p>
            <button type="button" onClick={moveToNextRound} className="btn-primary text-xs">
              Move to Next Round
            </button>
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between gap-2"><div><p className="text-sm font-bold text-ink">Live Answers</p><p className="text-[11px] text-stone">Every player’s question, choice, and outcome</p></div><Users size={18} className="text-royal" /></div>
        {visibleAnswerFeed.length === 0 ? <p className="text-xs text-stone">Answers will appear here as players submit them.</p> : <div className="max-h-72 space-y-2 overflow-y-auto">{visibleAnswerFeed.map((item) => {
          const feedQuestion = questions[item.question_index];
          return <div key={`${item.user_id}-${item.question_index}`} className={cn('rounded-lg border p-3 animate-fade-in', item.is_correct ? 'border-sage/35 bg-sage/10' : 'border-coral/30 bg-coral/8')}>
            <div className="flex items-start gap-2.5"><div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface text-[10px] font-bold">{item.avatar_url ? <img src={item.avatar_url} alt={item.display_name} className="h-full w-full object-cover" /> : item.user_id === 'arena-machine' ? <Zap size={15} className="text-gold" /> : item.display_name.charAt(0)}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-bold text-ink">{item.display_name}</p><span className={cn('text-[10px] font-bold', item.is_correct ? 'text-sage' : 'text-coral')}>{item.is_correct ? 'Correct' : 'Incorrect'}</span></div><p className="mt-1 text-xs leading-relaxed text-stone">{feedQuestion?.question || `Question ${item.question_index + 1}`}</p><p className="mt-1 text-xs font-semibold text-ink">Selected: {item.submitted_answer || 'No answer'}</p></div></div>
          </div>;
        })}</div>}
      </div>
    </div>
  );
}
