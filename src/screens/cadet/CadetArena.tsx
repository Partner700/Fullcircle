import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, EmptyState } from '../../components/AppShell';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { AppSelect } from '../../components/AppSelect';
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
  fetchRhudeBoard,
  fetchArenaInvitees,
  prepareArenaQuestionDeck,
  fetchPanelImageSetting,
} from '../../lib/queries';
import { playSoundEffect, setScenarioSound } from '../../lib/soundscape';
import { cn, formatDenarii } from '../../lib/utils';
import { ARENA_GAME_CALL_FEE } from '../../lib/constants';
import { activeArenaRoomStorageKey } from '../../lib/dailyGames';
import { VallumAvatarBadge } from '../../components/VallumAvatarBadge';
import type { QuestionPayload, Profile, RoleAssignment, PanelImageSetting } from '../../lib/types';
import type { ArenaTriviaFeedItem } from '../../lib/queries';
import {
  Swords, Users, Coins, Loader2, Zap, Trophy, Play, Plus, Clock, CheckCircle2, XCircle, UserPlus, Search, MessageCircle, Send, Flag,
  Shield, ArrowLeft, Dices, ChevronDown,
} from 'lucide-react';

type ArenaPhase = 'lobby' | 'waiting' | 'playing' | 'finished';
type InvitePlayer = RoleAssignment & { profiles: Profile };
const dismissedArenaRoomsKey = (userId: string) => `full-circle-dismissed-arena-rooms-${userId}`;

interface CadetArenaProps {
  onBalanceChanged?: () => Promise<void> | void;
  onBackToDailyGames?: () => void;
}

export function CadetArena({ onBalanceChanged, onBackToDailyGames }: CadetArenaProps) {
  const { profile } = useAuth();
  const [phase, setPhase] = useState<ArenaPhase>('lobby');
  const [rooms, setRooms] = useState<any[]>([]);
  const [denarii, setDenarii] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [roomName, setRoomName] = useState('Quick Match');
  const [stake, setStake] = useState(50);
  const [maxPlayers, setMaxPlayers] = useState(4);
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
  const [allInvitees, setAllInvitees] = useState<InvitePlayer[]>([]);
  const [taggedIds, setTaggedIds] = useState<Set<string>>(new Set());
  const [playerSearch, setPlayerSearch] = useState('');
  const [arenaImage, setArenaImage] = useState<PanelImageSetting | null>(null);
  const [finishSummary, setFinishSummary] = useState<{ room: any | null; rhudes: number | null } | null>(null);
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
    const savedRoomId = window.localStorage.getItem(activeArenaRoomStorageKey(profile.id));
    const dismissed = new Set(JSON.parse(window.localStorage.getItem(dismissedArenaRoomsKey(profile.id)) || '[]'));
    if (savedRoomId && !dismissed.has(savedRoomId)) setActiveRoomId(savedRoomId);
    if (savedRoomId && dismissed.has(savedRoomId)) window.localStorage.removeItem(activeArenaRoomStorageKey(profile.id));
  }, [profile]);

  useEffect(() => {
    if (!profile || !activeRoomId) return;
    window.localStorage.setItem(activeArenaRoomStorageKey(profile.id), activeRoomId);
  }, [profile, activeRoomId]);

  const clearActiveRoom = useCallback((dismiss = false) => {
    if (profile && activeRoomId) {
      window.localStorage.removeItem(activeArenaRoomStorageKey(profile.id));
      if (dismiss) {
        const key = dismissedArenaRoomsKey(profile.id);
        const dismissed = new Set<string>(JSON.parse(window.localStorage.getItem(key) || '[]'));
        dismissed.add(activeRoomId);
        window.localStorage.setItem(key, JSON.stringify(Array.from(dismissed).slice(-20)));
      }
    }
    setActiveRoomId(null);
    setPhase('lobby');
    setFinishSummary(null);
  }, [activeRoomId, profile]);

  const activateRoom = useCallback((roomId: string, nextPhase: ArenaPhase = 'waiting') => {
    if (profile) {
      const dismissedKey = dismissedArenaRoomsKey(profile.id);
      const dismissed = new Set<string>(JSON.parse(window.localStorage.getItem(dismissedKey) || '[]'));
      dismissed.delete(roomId);
      window.localStorage.setItem(dismissedKey, JSON.stringify(Array.from(dismissed)));
      window.localStorage.setItem(activeArenaRoomStorageKey(profile.id), roomId);
    }
    setActiveRoomId(roomId);
    setPhase(nextPhase);
    setFinishSummary(null);
  }, [profile]);

  const load = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    try {
      const [roomsData, balance, invitees, panelImage] = await Promise.allSettled([
        fetchArenaRooms(),
        fetchLedgerTotal(profile.id),
        fetchArenaInvitees(),
        fetchPanelImageSetting('arena'),
      ]);
      setRooms(roomsData.status === 'fulfilled' ? roomsData.value : []);
      setDenarii(balance.status === 'fulfilled' ? balance.value : 0);
      setAllInvitees((invitees.status === 'fulfilled' ? invitees.value : []).filter((c) => c.user_id !== profile.id));
      setArenaImage(panelImage.status === 'fulfilled' ? panelImage.value : null);
    } catch (e) {
      console.error('Arena load error:', e);
    } finally {
      setLoading(false);
    }
  }, [profile]);

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
          if (freshRoom?.status === 'completed') {
            setRooms((prev) => [freshRoom, ...prev.filter((item) => item.id !== freshRoom.id)]);
            setPhase('finished');
            setError(null);
            return;
          }
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
    if (room.status === 'completed') {
      if (parseArenaGameType(room.room_name || '') === 'ludo' && room.completion_reason !== 'forfeit') {
        if (phase !== 'playing') setPhase('playing');
      } else if (phase !== 'finished') {
        if (profile) {
          void fetchRhudeBoard()
            .then((rows) => {
              const mine = rows.find((row) => row.user_id === profile.id);
              setFinishSummary({ room, rhudes: mine ? Number(mine.rhudes) || 0 : 0 });
            })
            .catch(() => setFinishSummary({ room, rhudes: null }));
        } else {
          setFinishSummary({ room, rhudes: null });
        }
        setPhase('finished');
        if (profile) window.localStorage.removeItem(activeArenaRoomStorageKey(profile.id));
      }
    }
    const myParticipant = (room.arena_participants || []).find((participant: any) => participant.user_id === profile?.id);
    if (myParticipant?.forfeited_at && room.status === 'playing') {
      setError(myParticipant.forfeit_reason === 'inactive'
        ? 'You were away from this Arena match for three minutes and forfeited your place.'
        : 'You forfeited this Arena match.');
      clearActiveRoom(true);
    }
  }, [activeRoomId, phase, rooms, profile, clearActiveRoom]);

  useEffect(() => {
    if (!activeRoomId || phase !== 'waiting') return;
    let cancelled = false;
    const refreshActiveRoom = async () => {
      try {
        const freshRoom = await fetchArenaRoom(activeRoomId);
        if (cancelled || !freshRoom) return;
        setRooms((prev) => [freshRoom, ...prev.filter((item) => item.id !== freshRoom.id)]);
        if (freshRoom.status === 'playing') setPhase('playing');
        if (['cancelled', 'expired'].includes(freshRoom.status)) clearActiveRoom(false);
      } catch {
        // Realtime/polling will try again; keep the waiting room mounted.
      }
    };
    void refreshActiveRoom();
    const interval = window.setInterval(() => { void refreshActiveRoom(); }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeRoomId, clearActiveRoom, phase]);

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
      const difficultySuffix = arenaOpponent === 'machine' ? ` [difficulty:${arenaDifficulty}]` : '';
      const fullRoomName = `${roomName} [arena:${arenaGameType}]${difficultySuffix}`;
      const roomId = arenaOpponent === 'machine'
        ? await createMachineArenaRoom(profile.id, fullRoomName)
        : await createArenaRoom(profile.id, fullRoomName, stake, maxPlayers, undefined, Array.from(taggedIds));
      activateRoom(roomId, 'waiting');
      setShowCreate(false);
      setTaggedIds(new Set());
      setPlayerSearch('');
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
      setPlayerSearch('');
      await load();
      if (invited === 0) setError('No new players were invited.');
    } catch (e: any) {
      setError(e.message || 'Failed to send invites');
    }
    setInviting(false);
  };

  if (loading && phase === 'lobby') return (
    <div className="space-y-4 animate-fade-in">
      {onBackToDailyGames && (
        <button type="button" onClick={onBackToDailyGames} className="btn-ghost text-sm">
          <ArrowLeft size={15} /> Back to Daily Games
        </button>
      )}
      <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-brass" /></div>
    </div>
  );

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
            const generated = await prepareArenaQuestionDeck({
              roomId: activeRoomId,
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
        roomName={activeRoom?.room_name || roomName}
        roomId={activeRoomId}
        userId={profile!.id}
        roomQuestionSet={activeRoom?.question_set}
        onComplete={async (score, correctCount) => {
          try {
            await finishArenaGame(activeRoomId, profile!.id, score, correctCount);
          } catch (finishError) {
            console.error('Arena finish settlement failed', finishError);
          }
          const [freshRoomResult, rhudeResult] = await Promise.allSettled([
            fetchArenaRoom(activeRoomId),
            fetchRhudeBoard(),
          ]);
          const finishedRoom = freshRoomResult.status === 'fulfilled' ? freshRoomResult.value : null;
          const rhudes = rhudeResult.status === 'fulfilled'
            ? Number(rhudeResult.value.find((row) => row.user_id === profile!.id)?.rhudes) || 0
            : null;
          if (finishedRoom) setRooms((prev) => [finishedRoom, ...prev.filter((item) => item.id !== finishedRoom.id)]);
          setFinishSummary({ room: finishedRoom, rhudes });
          setPhase('finished');
          await onBalanceChanged?.();
        }}
        onForfeit={forfeitStandardMatch}
        forfeiting={forfeiting}
        onExit={() => clearActiveRoom(true)}
      />
    );
  }

  if (phase === 'finished' && activeRoomId) {
    const room = finishSummary?.room || rooms.find((r) => r.id === activeRoomId);
    const winner = room?.winner_id === profile?.id;
    const participantCount = Math.max(1, room?.arena_participants?.length || (room?.play_mode === 'machine' ? 1 : 0));
    const prize = (room?.stake_amount || 0) * participantCount * 10;
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
            {winner ? `You won ${formatDenarii(prize)} Ð and earned 1 Rhude for this Arena victory.` : room?.completion_reason === 'forfeit' ? 'The match ended by forfeiture.' : 'Better luck next time!'}
          </p>
          {winner && (
            <div className="mb-5 rounded-xl border border-royal/25 bg-royal-soft px-4 py-3">
              <p className="eyebrow mb-1 flex items-center justify-center gap-1.5 text-royal"><Shield size={13} /> Valley Count</p>
              <p className="font-display text-2xl font-bold text-ink">
                {finishSummary?.rhudes == null ? 'Updated' : finishSummary.rhudes}
                {finishSummary?.rhudes != null && <span className="ml-1 text-sm font-semibold text-stone">Rhudes</span>}
              </p>
            </div>
          )}
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
    const availableInvitees = allInvitees.filter((player) => !participants.some((p: any) => p.user_id === player.user_id));

    return (
      <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <button onClick={() => clearActiveRoom(true)} className="btn-ghost text-sm">← Back</button>
          <span className="badge badge-gold"><Clock size={12} /> Waiting Room</span>
        </div>

        {error && <div className="p-3 rounded-lg bg-coral-soft text-coral text-sm">{error}</div>}

        <div className="card relative overflow-hidden p-5">
          <PanelImageBackdrop image={arenaImage} opacityFallback={24} veilClassName="bg-navy-2/76" />
          <div className="relative z-10">
          <h3 className="font-display text-lg font-semibold text-ink mb-1">{room?.room_name || 'Arena Room'}</h3>
          <div className="flex items-center gap-3 text-sm text-stone mb-4">
            <span className="flex items-center gap-1"><Coins size={14} className="text-gold" /> {formatDenarii(room?.stake_amount || 0)} Ð stake</span>
            <span className="flex items-center gap-1"><Users size={14} /> {participants.length}/{room?.max_players || 4}</span>
            <span className="flex items-center gap-1"><Trophy size={14} className="text-gold" /> {formatDenarii(pot)} Ð pot</span>
            {minutesUntilExpiry !== null && (
              <span className="flex items-center gap-1"><Clock size={14} /> closes in {minutesUntilExpiry}m</span>
            )}
          </div>
          <p className="text-xs text-stone mb-4">
            {machineMatch ? `Machine target: ${room?.machine_score || 10} figs. Win to receive ten times your 50 denarii stake.` : 'The stake stays locked in this room. Empty rooms close after 15 minutes; once another player joins, the host has 10 minutes to launch before it closes.'}
          </p>

          <div className="space-y-2 mb-4">
            {participants.map((p: any) => (
              <div key={p.user_id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-2">
                <span className="relative flex h-8 w-8 items-center justify-center font-display text-sm font-bold text-gold">
                  <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-gold-soft">
                    {p.profiles?.avatar_url ? <img src={p.profiles.avatar_url} alt={p.profiles?.display_name || ''} className="h-full w-full object-cover" /> : (p.profiles?.display_name?.charAt(0) || '?')}
                  </span>
                  <VallumAvatarBadge userId={p.user_id} size="sm" />
                </span>
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
                <h4 className="text-xs font-display font-semibold text-ink">Invite Players</h4>
                <span className="text-[10px] text-stone">Only the host can invite or close</span>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone" />
                <input className="input-field pl-9 text-sm" placeholder="Search cadets and sentries..." value={playerSearch} onChange={(e) => setPlayerSearch(e.target.value)} />
              </div>
              {taggedIds.size > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Array.from(taggedIds).map((id) => {
                    const player = allInvitees.find((c) => c.user_id === id);
                    return (
                      <span key={id} className="badge badge-gold text-[10px] flex items-center gap-1">
                        {player?.profiles?.display_name || 'Unknown'}
                        <button onClick={() => { setTaggedIds((prev) => { const n = new Set(prev); n.delete(id); return n; }); }} className="hover:text-coral">×</button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="max-h-56 overflow-y-auto rounded-xl border border-border bg-surface/80 p-2 space-y-2">
                {availableInvitees
                  .filter((player) => !playerSearch || player.profiles?.display_name?.toLowerCase().includes(playerSearch.toLowerCase()))
                  .map((player) => {
                    const checked = taggedIds.has(player.user_id);
                    const initial = player.profiles?.display_name?.charAt(0)?.toUpperCase() || '?';
                    return (
                      <button
                        key={player.user_id}
                        type="button"
                        onClick={() => {
                          setTaggedIds((prev) => {
                            const n = new Set(prev);
                            if (n.has(player.user_id)) n.delete(player.user_id);
                            else n.add(player.user_id);
                            return n;
                          });
                        }}
                        className={cn(
                          'group flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-all',
                          checked
                            ? 'border-gold/60 bg-gold-soft shadow-sm'
                            : 'border-border bg-surface-2/80 hover:border-brass/45 hover:bg-surface-3',
                        )}
                        aria-pressed={checked}
                      >
                        <span className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center font-display font-bold text-brass">
                          <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-border bg-brass-soft">
                            {player.profiles?.avatar_url ? (
                              <img src={player.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                            ) : initial}
                          </span>
                          <VallumAvatarBadge userId={player.user_id} size="sm" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">{player.profiles?.display_name || 'Unknown'}</p>
                          <p className="text-[10px] uppercase tracking-[0.08em] text-stone">{player.role === 'sentry' ? 'Sentry' : 'Cadet'}</p>
                        </div>
                        <span className={cn(
                          'flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold transition-colors',
                          checked ? 'border-gold bg-gold text-navy' : 'border-border text-stone group-hover:border-brass group-hover:text-brass',
                        )}>
                          {checked ? '✓' : '+'}
                        </span>
                      </button>
                    );
                  })}
                {availableInvitees.length === 0 && <p className="text-xs text-stone text-center py-2">No more players available to invite.</p>}
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
      {onBackToDailyGames && (
        <button type="button" onClick={onBackToDailyGames} className="btn-ghost text-sm">
          <ArrowLeft size={15} /> Back to Daily Games
        </button>
      )}
      <div className="card relative overflow-hidden p-4 sm:p-5">
        <PanelImageBackdrop image={arenaImage} opacityFallback={22} veilClassName="bg-navy-2/78" />
        <div className="relative z-10">
          <SectionHeader title="The Arena" subtitle="Challenge cadets and sentries to real-time quiz battles. Stake denarii, winner takes all." />
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
              <AppSelect value={arenaOpponent} onChange={(value) => setArenaOpponent(value as 'players' | 'machine')} options={[{ value: 'players', label: 'Other players' }, { value: 'machine', label: 'Machine' }]} />
            </div>
            <div>
              <label className="text-xs text-stone block mb-1">Game Play</label>
              <AppSelect value={arenaGameType} onChange={(value) => setArenaGameType(value as 'standard' | 'ludo')} options={[{ value: 'standard', label: 'Standard Trivia' }, { value: 'ludo', label: 'Ludo Trivia' }]} />
            </div>
          </div>
          {arenaOpponent === 'machine' && <div>
            <label className="text-xs text-stone block mb-1">Machine Difficulty</label>
            <AppSelect value={arenaDifficulty} onChange={(value) => setArenaDifficulty(value as 'easy' | 'medium' | 'hard')} options={[
              { value: 'easy', label: 'Easy', description: 'Slower and less accurate' },
              { value: 'medium', label: 'Medium', description: 'Balanced' },
              { value: 'hard', label: 'Hard', description: 'Fast and highly accurate' },
            ]} />
          </div>}
          <p className="rounded-lg border border-brass/25 bg-brass-soft p-3 text-xs text-stone">
            {arenaGameType === 'standard' ? 'Standard Trivia: answer questions from previous Weekly and Fortune quizzes; the highest figs win.' : 'Ludo Trivia: previous Weekly and Fortune quiz questions move tokens around the board, with surprise spaces and relic effects.'}
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
            <label className="text-xs text-stone block mb-1.5">Tag Players <span className="text-stone/60">({taggedIds.size}/{maxPlayers - 1} spaces — they still choose whether to join)</span></label>
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone" />
              <input className="input-field pl-9 text-sm" placeholder="Search cadets and sentries..." value={playerSearch} onChange={(e) => setPlayerSearch(e.target.value)} />
            </div>
            {taggedIds.size > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {Array.from(taggedIds).map((id) => {
                  const player = allInvitees.find((c) => c.user_id === id);
                  return (
                    <span key={id} className="badge badge-gold text-[10px] flex items-center gap-1">
                      {player?.profiles?.display_name || 'Unknown'}
                      <button onClick={() => { setTaggedIds((prev) => { const n = new Set(prev); n.delete(id); return n; }); }} className="hover:text-coral">×</button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-border bg-surface-2 p-2">
              {allInvitees
                .filter((c) => !playerSearch || c.profiles?.display_name?.toLowerCase().includes(playerSearch.toLowerCase()))
                .map((player) => {
                  const checked = taggedIds.has(player.user_id);
                  const full = !checked && taggedIds.size >= maxPlayers - 1;
                  return (
                    <label key={player.user_id} className={cn('flex items-center gap-2 p-2 rounded-md transition-colors', full ? 'cursor-not-allowed opacity-45' : 'cursor-pointer', checked ? 'bg-gold-soft' : 'hover:bg-surface-3')}>
                      <input type="checkbox" checked={checked} disabled={full} onChange={() => {
                        setTaggedIds((prev) => {
                          const n = new Set(prev);
                          if (n.has(player.user_id)) n.delete(player.user_id);
                          else n.add(player.user_id);
                          return n;
                        });
                      }} className="accent-gold flex-shrink-0" />
                      <span className="relative flex h-6 w-6 flex-shrink-0 items-center justify-center font-display text-[10px] font-bold text-gold">
                        <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-gold-soft">
                          {player.profiles?.avatar_url ? <img src={player.profiles.avatar_url} alt={player.profiles?.display_name || ''} className="h-full w-full object-cover" /> : (player.profiles?.display_name?.charAt(0) || '?')}
                        </span>
                        <VallumAvatarBadge userId={player.user_id} size="xs" />
                      </span>
                      <span className="text-sm text-ink truncate flex-1">{player.profiles?.display_name || 'Unknown'}</span>
                      <span className="badge badge-brass text-[9px] capitalize">{player.role}</span>
                    </label>
                  );
                })}
              {allInvitees.length === 0 && <p className="text-xs text-stone text-center py-2">No other players available.</p>}
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
          <EmptyState icon={(props) => <Swords {...props} />} title="No open rooms" message="Create a room and invite other players to battle." />
        ) : (
          rooms.filter((r) => r.status === 'waiting').map((room) => {
            const participants = room.arena_participants || [];
            const isParticipant = participants.some((p: any) => p.user_id === profile?.id);
            const host = participants.find((p: any) => p.user_id === room.creator_id)?.profiles;
            const invited = Array.isArray(room.tagged_user_ids) && profile?.id ? room.tagged_user_ids.includes(profile.id) : false;
            const expiresAt = room.expires_at ? new Date(room.expires_at).getTime() : null;
            const minutesUntilExpiry = expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000)) : null;
            const pot = room.stake_amount * participants.length * 10;
            return (
              <div key={room.id} className="card relative overflow-hidden p-4 flex items-center gap-3">
                <PanelImageBackdrop image={arenaImage} opacityFallback={18} veilClassName="bg-navy-2/80" />
                <div className="relative z-10 w-10 h-10 rounded-lg bg-gold-soft flex items-center justify-center flex-shrink-0">
                  <Swords size={20} className="text-gold" />
                </div>
                <div className="relative z-10 flex-1 min-w-0">
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
                  <button onClick={() => activateRoom(room.id, 'waiting')} className="btn-secondary relative z-10 text-xs">
                    Enter Room
                  </button>
                ) : (
                  <button onClick={() => joinRoom(room.id)} disabled={denarii < room.stake_amount || participants.length >= room.max_players}
                    className="btn-primary relative z-10 text-xs disabled:opacity-40">
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

function parseArenaGameType(roomName: string) {
  return /\[arena:ludo\]/i.test(roomName) ? 'ludo' : 'standard';
}

function parseArenaDifficulty(roomName: string): 'easy' | 'medium' | 'hard' {
  const match = roomName.match(/\[difficulty:(easy|medium|hard)\]/i);
  return (match?.[1]?.toLowerCase() as 'easy' | 'medium' | 'hard') || 'medium';
}

function ArenaWaitingChat({ roomId, userId, compact = false }: { roomId: string; userId: string; compact?: boolean }) {
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
    <div className={cn(compact ? 'p-3 pt-1' : 'mb-4 rounded-lg border border-border bg-surface/80 p-3')}>
      {!compact && <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink"><MessageCircle size={14} className="text-brass" /> Room chat</div>}
      <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 ? <p className="py-3 text-center text-xs text-stone">Talk while the room fills.</p> : messages.map((message) => {
          const mine = message.sender_id === userId;
          return <div key={message.id} className={cn('flex gap-2', mine ? 'justify-end' : 'justify-start')}>
            {!mine && <span className="relative mt-0.5 flex h-6 w-6 items-center justify-center text-[10px] leading-6 text-gold"><span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-gold-soft">{message.sender?.avatar_url ? <img src={message.sender.avatar_url} alt="" className="h-full w-full object-cover" /> : message.sender?.display_name?.charAt(0) || '?'}</span><VallumAvatarBadge userId={message.sender_id} size="xs" /></span>}
            <p className={cn('max-w-[80%] rounded-lg px-2.5 py-1.5 text-xs', mine ? 'bg-brass/15 text-ink' : 'bg-surface-2 text-ink')}><span className="mr-1 font-semibold">{mine ? 'You' : message.sender?.display_name || 'Cadet'}</span>{message.body}</p>
          </div>;
        })}</div>
      <div className="mt-3 flex gap-2"><input value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void send(); } }} className="input-field min-w-0 flex-1 text-sm" placeholder="Write a message..." /><button type="button" onClick={() => void send()} disabled={!body.trim() || sending} className="btn-primary px-3" aria-label="Send room message">{sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}</button></div>
    </div>
  );
}

const ARENA_ROUND_LENGTHS = [6, 6, 6, 1];

type ArenaBoardPlayer = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  score: number;
  active: boolean;
};

const ARENA_BOARD_PATH = Array.from({ length: 20 }, (_, index) => {
  if (index < 6) return { row: 1, column: index + 1 };
  if (index < 11) return { row: index - 4, column: 6 };
  if (index < 16) return { row: 6, column: 16 - index };
  return { row: 21 - index, column: 1 };
});

function ArenaBattleBoard({
  players,
  currentQuestion,
  isMyTurn,
  rolling,
  dieValue,
  latestOutcome,
  waitingName,
  onRoll,
}: {
  players: ArenaBoardPlayer[];
  currentQuestion: number;
  isMyTurn: boolean;
  rolling: boolean;
  dieValue: number;
  latestOutcome: { player: string; correct: boolean; answer: string } | null;
  waitingName?: string | null;
  onRoll: () => void;
}) {
  return (
    <section className="relative mx-auto aspect-square w-full max-w-[42rem] overflow-hidden rounded-lg border-2 border-brass/45 bg-navy-2 p-2 shadow-xl sm:p-3" aria-label="Arena battle board">
      <div className="absolute inset-0 opacity-35" style={{ backgroundImage: 'radial-gradient(circle at center, rgba(232,185,88,0.18), transparent 52%), linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)', backgroundSize: 'auto, 24px 24px, 24px 24px' }} aria-hidden="true" />
      <div className="relative grid h-full w-full grid-cols-6 grid-rows-6 gap-1 sm:gap-2">
        {ARENA_BOARD_PATH.map((position, index) => {
          const occupants = players.filter((player) => Math.min(19, Math.max(0, player.score)) === index);
          const activeSpace = Math.min(19, currentQuestion) === index;
          return (
            <div
              key={index}
              className={cn(
                'relative flex min-h-0 items-center justify-center rounded-md border text-[8px] font-black transition-all sm:text-[10px]',
                index === 0 ? 'border-sage/70 bg-sage/25 text-sage' : index === 19 ? 'border-gold/80 bg-gold/25 text-gold' : 'border-white/15 bg-white/[0.07] text-white/45',
                activeSpace && 'border-brass bg-brass/20 text-brass shadow-[0_0_16px_rgba(232,185,88,0.28)]',
              )}
              style={{ gridRow: position.row, gridColumn: position.column }}
            >
              <span className="absolute left-1 top-0.5 opacity-70">{index === 0 ? 'START' : index === 19 ? 'CROWN' : index}</span>
              {occupants.length > 0 && (
                <span className="flex -space-x-1.5">
                  {occupants.slice(0, 4).map((player) => (
                    <span key={player.userId} className={cn('relative inline-flex h-5 w-5 items-center justify-center rounded-full border-2 bg-surface text-[7px] font-bold text-ink shadow-md sm:h-7 sm:w-7 sm:text-[9px]', player.active ? 'border-gold' : 'border-white/70')} title={`${player.name}: ${player.score} figs`}>
                      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full">{player.avatarUrl ? <img src={player.avatarUrl} alt={player.name} className="h-full w-full object-cover" /> : player.name.charAt(0).toUpperCase()}</span>
                      <VallumAvatarBadge userId={player.userId === 'arena-machine' ? null : player.userId} size="xs" />
                    </span>
                  ))}
                </span>
              )}
            </div>
          );
        })}

        <div className="col-start-2 col-end-6 row-start-2 row-end-6 flex min-h-0 flex-col items-center justify-center rounded-lg border border-white/10 bg-navy/72 p-3 text-center shadow-inner backdrop-blur-sm">
          {isMyTurn ? (
            <button
              type="button"
              onClick={onRoll}
              disabled={rolling}
              className="group flex h-24 w-24 flex-col items-center justify-center rounded-2xl border-2 border-gold/70 bg-gold/10 text-gold shadow-[0_0_30px_rgba(232,185,88,0.18)] transition-transform hover:scale-105 disabled:cursor-wait sm:h-32 sm:w-32"
              aria-label="Roll the Arena die"
            >
              <Dices size={rolling ? 38 : 46} className={cn(rolling && 'animate-spin')} />
              <span className="mt-1 font-display text-2xl font-black">{dieValue}</span>
              <span className="text-[9px] font-black uppercase text-white/70 sm:text-[10px]">{rolling ? 'Rolling' : 'Roll'}</span>
            </button>
          ) : (
            <div className="flex flex-col items-center gap-3 text-white/70">
              <Loader2 size={30} className="animate-spin text-royal" />
              <p className="text-sm font-bold">{waitingName ? `${waitingName}'s turn` : 'Waiting for the next turn'}</p>
            </div>
          )}
          {latestOutcome && (
            <div className={cn('mt-4 rounded-full border px-3 py-1 text-[10px] font-bold sm:text-xs', latestOutcome.correct ? 'border-sage/45 bg-sage/15 text-sage' : 'border-coral/45 bg-coral/15 text-coral')}>
              {latestOutcome.player}: {latestOutcome.correct ? 'Right' : 'Wrong'}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
function getArenaQuestionSeconds(question: QuestionPayload | undefined) {
  if (question?.round_timer_seconds) return question.round_timer_seconds;
  if (question?.game_round === 1 || question?.difficulty_tag === 'easy') return 17;
  if (question?.game_round === 2 || question?.difficulty_tag === 'moderate') return 14;
  return 11;
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

function dedupeArenaQuestions(items: QuestionPayload[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.question}|${item.correct_answer}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ArenaGamePlay({ roomName, roomId, userId, roomQuestionSet, onComplete, onForfeit, forfeiting, onExit }: {
  roomName: string;
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
  const [currentQ, setCurrentQ] = useState(0);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [answeredIds, setAnsweredIds] = useState<Set<number>>(new Set());
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [machineScore, setMachineScore] = useState(0);
  const [turnPhase, setTurnPhase] = useState<'user' | 'user-feedback' | 'machine-thinking' | 'machine-feedback'>('user');
  const [answerFeedback, setAnswerFeedback] = useState<{ correct: boolean; answer: string } | null>(null);
  const [latestOutcome, setLatestOutcome] = useState<{ player: string; correct: boolean; answer: string } | null>(null);
  const [matchPlayers, setMatchPlayers] = useState<{ user_id: string; display_name: string; avatar_url: string | null; rhudes: number }[]>([]);
  const [timeLeft, setTimeLeft] = useState(40);
  const [ready, setReady] = useState(false);
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [dieValue, setDieValue] = useState(1);
  const [questionRetry, setQuestionRetry] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scoreRef = useRef(0);
  const correctCountRef = useRef(0);
  const completedRef = useRef(false);
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
      const [{ data: profiles }, rhudeResult] = await Promise.all([
        ids.length ? supabase.from('profiles').select('id,display_name,avatar_url').in('id', ids) : Promise.resolve({ data: [] as any[] }),
        fetchRhudeBoard().then((data) => ({ data })).catch(() => ({ data: [] })),
      ]);
      const byId = new Map((profiles || []).map((item) => [item.id, item]));
      const rhudesById = new Map((rhudeResult.data || []).map((item: any) => [item.user_id, Number(item.rhudes) || 0]));
      if (!cancelled) setMatchPlayers(ids.map((id) => ({
        user_id: id,
        display_name: byId.get(id)?.display_name || 'Arena player',
        avatar_url: byId.get(id)?.avatar_url || null,
        rhudes: rhudesById.get(id) || 0,
      })));
    })();
    return () => { cancelled = true; };
  }, [machineMatch, roomId]);

  const completeGame = useCallback((finalScore = scoreRef.current, finalCorrectCount = correctCountRef.current) => {
    if (completedRef.current) return;
    completedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    void heartbeatArenaParticipant(roomId, userId).catch(() => null);
    onComplete(finalScore, finalCorrectCount);
  }, [onComplete, roomId, userId]);

  useEffect(() => {
    if (machineMatch || !ready || questions.length === 0 || matchPlayers.length === 0) return;
    const nextIndex = Math.min(answerFeed.length, questions.length);
    if (nextIndex >= questions.length) {
      completeGame(scoreRef.current, correctCountRef.current);
      return;
    }
    if (nextIndex !== currentQ) {
      setCurrentQ(nextIndex);
      setTypedAnswer('');
      setAnswerFeedback(null);
      setQuestionOpen(false);
      setRolling(false);
    }
    const latest = answerFeed[answerFeed.length - 1];
    if (latest) setLatestOutcome({ player: latest.display_name, correct: latest.is_correct, answer: latest.submitted_answer || 'No answer' });
    setTurnPhase(matchPlayers[nextIndex % matchPlayers.length]?.user_id === userId ? 'user' : 'machine-thinking');
  }, [answerFeed, answerFeed.length, currentQ, machineMatch, matchPlayers, questions.length, ready, userId, completeGame]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const distinctRoomQuestions = Array.isArray(roomQuestionSet) ? dedupeArenaQuestions(roomQuestionSet) : [];
      if (distinctRoomQuestions.length >= 19) {
        setQuestions(distinctRoomQuestions);
        setReady(true);
        return;
      }
      try {
        const archiveQuestions = await prepareArenaQuestionDeck({
          roomId,
        });
        if (!cancelled) {
          setQuestions(dedupeArenaQuestions(archiveQuestions));
          setReady(true);
        }
        return;
      } catch (e) {
        console.error('Arena quiz archive preparation failed.', e);
        if (!cancelled) {
          setAnswerError(e instanceof Error ? e.message : 'The Arena could not prepare its questions.');
          setReady(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [roomId, roomQuestionSet, questionRetry]);

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
      await heartbeatArenaParticipant(roomId, userId).catch(() => true);
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
    setLatestOutcome({ player: profile?.display_name || 'You', correct: result.correct, answer: answer || 'No answer' });
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
      setQuestionOpen(false);
      setTurnPhase('user');
    };

    await new Promise<void>((resolve) => window.setTimeout(resolve, 900));
    setQuestionOpen(false);
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
    const nextMachineScore = result.machineTotalFigs;
    setMachineScore(nextMachineScore);
    setLatestOutcome({ player: 'The Scribe', correct: machineCorrect, answer: selected });
    setTurnPhase('machine-feedback');
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1100));
    advance(nextMachineScore, 2);
  }, [answeredIds, questions, currentQ, turnPhase, isMyTurn, refreshAnswerFeed, roomId, userId, machineMatch, machineDifficulty, completeGame, profile?.display_name]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const activeQuestion = questions[currentQ];
    if (!ready || !activeQuestion || !questionOpen) return;
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
  }, [ready, questions, currentQ, answeredIds, completeGame, handleAnswer, turnPhase, isMyTurn, questionOpen]);

  const rollDie = useCallback(() => {
    if (!isMyTurn || turnPhase !== 'user' || rolling || questionOpen || answeredIds.has(currentQ)) return;
    setRolling(true);
    setAnswerError(null);
    let ticks = 0;
    const animation = window.setInterval(() => {
      setDieValue(Math.floor(Math.random() * 6) + 1);
      ticks += 1;
      if (ticks < 8) return;
      window.clearInterval(animation);
      setRolling(false);
      setQuestionOpen(true);
      void playSoundEffect('sound_arena_round', 0.62);
    }, 70);
  }, [answeredIds, currentQ, isMyTurn, questionOpen, rolling, turnPhase]);

  if (!ready) return <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-brass" /></div>;

  if (questions.length === 0) {
    return (
      <div className="mx-auto max-w-md py-8">
        <div className="card p-6 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-coral-soft text-coral">
            <XCircle size={24} />
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold text-ink">Arena questions did not load</h3>
            <p className="mt-1 text-sm text-stone">{answerError || 'No verified questions are available for this Arena game.'}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => {
                setAnswerError(null);
                setQuestions([]);
                setReady(false);
                setQuestionRetry((value) => value + 1);
              }}
              className="btn-primary"
            >
              <Loader2 size={14} className={cn(!ready && 'animate-spin')} />
              Try Again
            </button>
            <button onClick={onExit} className="btn-secondary">Back to Arena</button>
          </div>
        </div>
      </div>
    );
  }

  const q = questions[currentQ];
  const currentRound = getArenaRoundForIndex(currentQ);
  const roundQuestionStart = ARENA_ROUND_LENGTHS.slice(0, currentRound).reduce((sum, length) => sum + length, 0);
  const roundQuestionNumber = currentQ - roundQuestionStart + 1;
  const isCurrentAnswered = answeredIds.has(currentQ);
  const feedScores = answerFeed.reduce((scores, item) => {
    scores.set(item.user_id, (scores.get(item.user_id) || 0) + item.figs_earned);
    return scores;
  }, new Map<string, number>());
  const boardPlayers: ArenaBoardPlayer[] = machineMatch
    ? [
        { userId, name: profile?.display_name || 'You', avatarUrl: profile?.avatar_url || null, score, active: isMyTurn && turnPhase === 'user' },
        { userId: 'arena-machine', name: 'The Scribe', avatarUrl: null, score: machineScore, active: turnPhase.startsWith('machine') },
      ]
    : matchPlayers.map((player) => ({
        userId: player.user_id,
        name: player.display_name,
        avatarUrl: player.avatar_url,
        score: player.user_id === userId ? score : feedScores.get(player.user_id) || 0,
        active: player.user_id === activeRealPlayer?.user_id,
      }));
  const waitingName = machineMatch && turnPhase.startsWith('machine') ? 'The Scribe' : activeRealPlayer?.display_name;

  return (
    <div className="mx-auto max-w-3xl space-y-3 animate-fade-in">
      <div className="flex items-center justify-between gap-2 px-1">
        <button onClick={onForfeit} disabled={forfeiting} className="btn-ghost text-sm text-coral disabled:opacity-50">
          {forfeiting ? <Loader2 size={14} className="animate-spin" /> : <Flag size={14} />} Forfeit
        </button>
        <span className="badge badge-gold"><Zap size={12} /> Arena Battle</span>
        <span className="text-xs font-bold text-stone">Round {currentRound + 1}</span>
      </div>

      <div className="flex gap-1.5 px-1">
        {ARENA_ROUND_LENGTHS.map((_, i) => (
          <div key={i} className={cn(
            'h-1.5 flex-1 rounded-full transition-colors',
            i < currentRound ? 'bg-sage' : i === currentRound ? 'bg-gold' : 'bg-surface-2',
          )} />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 px-1 text-[11px] text-stone sm:text-xs">
        <span>Question <strong className="text-ink">{currentQ + 1}</strong> / {questions.length}</span>
        <span className="truncate">{boardPlayers.map((player) => `${player.name} ${player.score}`).join(' · ')}</span>
      </div>
      <ArenaBattleBoard
        players={boardPlayers}
        currentQuestion={currentQ}
        isMyTurn={isMyTurn && turnPhase === 'user' && !questionOpen && !isCurrentAnswered}
        rolling={rolling}
        dieValue={dieValue}
        latestOutcome={latestOutcome}
        waitingName={waitingName}
        onRoll={rollDie}
      />

      {!machineMatch && (
        <details className="group overflow-hidden rounded-lg border border-border bg-surface/80">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-xs font-bold text-ink">
            <span className="flex items-center gap-2"><MessageCircle size={14} className="text-brass" /> Room chat</span>
            <ChevronDown size={15} className="text-stone transition-transform group-open:rotate-180" />
          </summary>
          <ArenaWaitingChat roomId={roomId} userId={userId} compact />
        </details>
      )}

      {questionOpen && isMyTurn && (turnPhase === 'user' || turnPhase === 'user-feedback') && (
        <div className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-black/65 px-4 py-6 backdrop-blur-sm">
          <div className="relative z-[2147483001] max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg border border-gold/45 bg-bg p-5 shadow-2xl sm:p-6" role="dialog" aria-modal="true" aria-label="Arena question">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center text-sm font-bold text-ink"><span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border-2 border-gold bg-surface-2">{profile?.avatar_url ? <img src={profile.avatar_url} alt={profile.display_name} className="h-full w-full object-cover" /> : profile?.display_name?.charAt(0) || 'Y'}</span><VallumAvatarBadge userId={profile?.id} size="sm" /></span>
                <div className="min-w-0"><p className="text-xs font-bold text-ink">{profile?.display_name || 'Your question'}</p><p className="eyebrow mt-0.5">{q.is_bonus ? 'Bonus · 2 figs' : `Round ${currentRound + 1} · Question ${roundQuestionNumber}`}</p></div>
              </div>
              <div className={cn('flex h-11 min-w-11 items-center justify-center rounded-full border px-2 font-display text-sm font-black', timeLeft <= 5 ? 'border-coral bg-coral-soft text-coral' : timeLeft <= 10 ? 'border-gold bg-gold-soft text-gold' : 'border-sage bg-sage-soft text-sage')}><Clock size={13} className="mr-1" />{timeLeft}</div>
            </div>
            {answerError && <div className="mb-4 rounded-md border border-coral/35 bg-coral-soft px-3 py-2 text-sm text-coral" role="alert">{answerError}</div>}
            <h3 className="mb-5 font-display text-lg font-semibold leading-snug text-ink sm:text-xl">{q.question}</h3>
            {answerFeedback && <div className={cn('mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-bold', answerFeedback.correct ? 'border-sage/40 bg-sage-soft text-sage' : 'border-coral/40 bg-coral-soft text-coral')}>{answerFeedback.correct ? <CheckCircle2 size={18} /> : <XCircle size={18} />}{answerFeedback.correct ? 'Right answer' : 'Wrong answer'}</div>}
            {q.type === 'true_false' && <div className="grid grid-cols-2 gap-3"><button onClick={() => void handleAnswer('True')} disabled={isCurrentAnswered || submittingAnswer || turnPhase !== 'user'} className="rounded-lg border-2 border-sage py-4 font-display text-lg font-bold text-sage transition-colors hover:bg-sage-soft"><CheckCircle2 size={24} className="mx-auto mb-1" />True</button><button onClick={() => void handleAnswer('False')} disabled={isCurrentAnswered || submittingAnswer || turnPhase !== 'user'} className="rounded-lg border-2 border-coral py-4 font-display text-lg font-bold text-coral transition-colors hover:bg-coral-soft"><XCircle size={24} className="mx-auto mb-1" />False</button></div>}
            {(q.type === 'multiple_choice' || q.type === 'true_false') && q.options && q.type !== 'true_false' && <div className="space-y-2">{q.options.map((option, index) => <button key={index} onClick={() => void handleAnswer(option)} disabled={isCurrentAnswered || submittingAnswer || turnPhase !== 'user'} className="w-full rounded-lg border border-border p-3.5 text-left text-sm font-medium text-ink transition-colors hover:border-gold hover:bg-gold-soft">{option}</button>)}</div>}
            {(q.type === 'cloze' || q.type === 'scriptorium' || q.type === 'order_sequence' || q.type === 'matching' || q.type === 'standard_text') && <div className="space-y-2"><input className="input-field" placeholder="Type your answer..." autoFocus value={typedAnswer} onChange={(event) => setTypedAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && typedAnswer.trim()) void handleAnswer(typedAnswer.trim()); }} /><button className="btn-primary w-full" onClick={() => { if (typedAnswer.trim()) void handleAnswer(typedAnswer.trim()); }} disabled={!typedAnswer.trim() || isCurrentAnswered || submittingAnswer}>Submit</button></div>}
            {submittingAnswer && <div className="mt-3 flex items-center justify-center gap-2 text-xs font-bold text-stone"><Loader2 size={14} className="animate-spin" /> Checking answer</div>}
          </div>
        </div>
      )}
    </div>
  );
}
