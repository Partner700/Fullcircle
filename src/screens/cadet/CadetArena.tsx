import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, EmptyState } from '../../components/AppShell';
import { supabase } from '../../lib/supabase';
import {
  fetchLedgerTotal,
  createArenaRoom,
  inviteArenaPlayers,
  joinArenaRoom,
  startArenaRoom,
  closeArenaRoom,
  finishArenaGame,
  fetchArenaRooms,
  fetchArenaRoom,
  fetchNarrative,
  fetchNarratives,
  fetchActiveCadets,
  generateArenaQuestionsWithAI,
} from '../../lib/queries';
import { cn, formatDenarii } from '../../lib/utils';
import { ARENA_GAME_CALL_FEE } from '../../lib/constants';
import type { DailyNarrative, QuestionPayload, Profile, RoleAssignment } from '../../lib/types';
import {
  Swords, Users, Coins, Loader2, Zap, Trophy, Play, Plus, Clock, CheckCircle2, XCircle, UserPlus, Search,
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
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [preparingQuestions, setPreparingQuestions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allCadets, setAllCadets] = useState<InviteCadet[]>([]);
  const [taggedIds, setTaggedIds] = useState<Set<string>>(new Set());
  const [cadetSearch, setCadetSearch] = useState('');

  useEffect(() => {
    if (!profile) return;
    const savedRoomId = window.localStorage.getItem(activeArenaRoomKey(profile.id));
    const dismissed = new Set(JSON.parse(window.localStorage.getItem(dismissedArenaRoomsKey(profile.id)) || '[]'));
    if (savedRoomId && !dismissed.has(savedRoomId)) setActiveRoomId(savedRoomId);
    if (savedRoomId && dismissed.has(savedRoomId)) window.localStorage.removeItem(activeArenaRoomKey(profile.id));
  }, [profile?.id]);

  useEffect(() => {
    if (!profile || !activeRoomId) return;
    window.localStorage.setItem(activeArenaRoomKey(profile.id), activeRoomId);
  }, [profile?.id, activeRoomId]);

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
      const [roomsData, balance, narrs, cadets] = await Promise.allSettled([
        fetchArenaRooms(),
        fetchLedgerTotal(profile.id),
        fetchNarratives(30),
        fetchActiveCadets(),
      ]);
      setRooms(roomsData.status === 'fulfilled' ? roomsData.value : []);
      setDenarii(balance.status === 'fulfilled' ? balance.value : 0);
      setNarratives(narrs.status === 'fulfilled' ? narrs.value : []);
      setAllCadets((cadets.status === 'fulfilled' ? cadets.value : []).filter((c) => c.user_id !== profile.id));
      if (narrs.status === 'fulfilled' && narrs.value && narrs.value.length > 0 && !selectedNarrativeDate) setSelectedNarrativeDate(narrs.value[0].narrative_date);
    } catch (e) { console.error('Arena load error:', e); }
    setLoading(false);
  }, [profile, selectedNarrativeDate]);

  useEffect(() => { load(); }, [load]);

  const prepareQuestionsForRoom = useCallback(async (
    targetRoomId: string,
    targetRoomName: string,
    narrativeDate?: string | null,
    forceRegenerate = false,
  ) => {
    const topic = parseArenaTopic(targetRoomName);
    setPreparingQuestions(true);
    try {
      const cachedNarrative = narrativeDate
        ? narratives.find((item) => item.narrative_date === narrativeDate)
        : narratives[0];
      const narrative = cachedNarrative || (narrativeDate ? await fetchNarrative(narrativeDate) : null);
      await generateArenaQuestionsWithAI({
        roomId: targetRoomId,
        roomName: targetRoomName,
        topicType: topic?.type || 'narrative',
        topic: topic?.value || null,
        narrative: narrative || null,
        forceRegenerate,
      });
      await load();
    } finally {
      setPreparingQuestions(false);
    }
  }, [load, narratives]);

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
    if (room.status === 'completed' && phase !== 'finished') {
      setPhase('finished');
      if (profile) window.localStorage.removeItem(activeArenaRoomKey(profile.id));
    }
  }, [activeRoomId, phase, rooms, profile]);

  const createRoom = async () => {
    if (!profile) return;
    if ((arenaTopicType === 'book' || arenaTopicType === 'character') && !arenaTopic.trim()) {
      setError(`Enter the Bible ${arenaTopicType} this battle should use.`);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const topicSuffix = arenaTopicType === 'narrative' || !arenaTopic.trim()
        ? ''
        : ` [${arenaTopicType}: ${arenaTopic.trim()}]`;
      const fullRoomName = `${roomName}${topicSuffix}`;
      const roomId = await createArenaRoom(profile.id, fullRoomName, stake, maxPlayers, selectedNarrativeDate || undefined, Array.from(taggedIds));
      activateRoom(roomId, 'waiting');
      setShowCreate(false);
      setTaggedIds(new Set());
      setCadetSearch('');
      await load();
      try {
        await prepareQuestionsForRoom(roomId, fullRoomName, selectedNarrativeDate);
      } catch (generationError: any) {
        setError(`Room created, but its questions are not ready: ${generationError.message || 'generation failed'}`);
      }
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
      const room = rooms.find((item) => item.id === activeRoomId);
      if (!room) throw new Error('Arena room could not be loaded.');
      if (!hasCurrentArenaQuestionSet(room.question_set)) {
        await prepareQuestionsForRoom(activeRoomId, room.room_name, room.narrative_date, true);
      }
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
    return (
      <ArenaGamePlay
        narrativeDate={activeRoom?.narrative_date || selectedNarrativeDate}
        roomName={activeRoom?.room_name || roomName}
        startedAt={activeRoom?.started_at || null}
        narratives={narratives}
        roomId={activeRoomId}
        roomQuestionSet={activeRoom?.question_set}
        onComplete={async (score, correctCount) => {
          try {
            await finishArenaGame(activeRoomId, profile!.id, score, correctCount);
          } catch {}
          setPhase('finished');
          await load();
          await onBalanceChanged?.();
        }}
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
            {winner ? `You won the pot of ${formatDenarii((room?.stake_amount || 0) * (room?.arena_participants?.length || 1))} Ð` : 'Better luck next time!'}
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
    const canStart = participants.length >= 2;
    const questionsReady = hasCurrentArenaQuestionSet(room?.question_set);
    const pot = (room?.stake_amount || 0) * participants.length;
    const expiresAt = room?.expires_at ? new Date(room.expires_at).getTime() : null;
    const minutesUntilExpiry = expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000)) : null;
    const availableInviteCadets = allCadets.filter((cadet) => !participants.some((p: any) => p.user_id === cadet.user_id));

    return (
      <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button onClick={() => clearActiveRoom(true)} className="btn-ghost text-sm">← Back</button>
          <span className="badge badge-gold"><Clock size={12} /> Waiting Room</span>
        </div>

        {error && <div className="p-3 rounded-lg bg-coral-soft text-coral text-sm">{error}</div>}

        <div className="card p-4 sm:p-5">
          <h3 className="font-display text-lg font-semibold text-ink mb-1">{room?.room_name || 'Arena Room'}</h3>
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-stone">
            <span className="flex items-center gap-1"><Coins size={14} className="text-gold" /> {formatDenarii(room?.stake_amount || 0)} Ð stake</span>
            <span className="flex items-center gap-1"><Users size={14} /> {participants.length}/{room?.max_players || 4}</span>
            <span className="flex items-center gap-1"><Trophy size={14} className="text-gold" /> {formatDenarii(pot)} Ð pot</span>
            {minutesUntilExpiry !== null && participants.length <= 1 && (
              <span className="flex items-center gap-1"><Clock size={14} /> closes in {minutesUntilExpiry}m</span>
            )}
          </div>
          <p className="text-xs text-stone mb-4">
            The stake stays locked in this room. Signing out does not close it; only the host can close it, or it expires after six hours if no one else joins.
          </p>

          <div className={cn(
            'mb-4 flex items-center gap-2 rounded-lg border p-3 text-xs font-medium',
            questionsReady ? 'border-sage/30 bg-sage-soft text-sage' : 'border-gold/30 bg-gold-soft text-gold',
          )}>
            {questionsReady
              ? <CheckCircle2 size={16} className="flex-shrink-0" />
              : <Loader2 size={16} className={cn('flex-shrink-0', preparingQuestions && 'animate-spin')} />}
            <span>{questionsReady ? '19 unique Bible questions are ready.' : preparingQuestions ? 'Preparing a source-grounded battle...' : 'Questions need to be prepared before play.'}</span>
          </div>

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

          {isCreator && (
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
                            n.has(cadet.user_id) ? n.delete(cadet.user_id) : n.add(cadet.user_id);
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button onClick={startGame} disabled={!canStart || starting || preparingQuestions} className="btn-primary w-full disabled:opacity-50">
                {(starting || preparingQuestions) ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {preparingQuestions ? 'Preparing Questions...' : canStart ? questionsReady ? 'Start Game' : 'Prepare & Start' : 'Waiting for players...'}
              </button>
              <button onClick={closeRoom} disabled={closing} className="btn-secondary w-full text-coral disabled:opacity-50">
                {closing ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
                Close Room
              </button>
              {!questionsReady && !preparingQuestions && (
                <button
                  type="button"
                  onClick={async () => {
                    setError(null);
                    try {
                      await prepareQuestionsForRoom(activeRoomId, room.room_name, room.narrative_date, true);
                    } catch (generationError: any) {
                      setError(generationError.message || 'Question preparation failed.');
                    }
                  }}
                  className="btn-secondary w-full sm:col-span-2"
                >
                  <Zap size={16} /> Prepare Questions Now
                </button>
              )}
            </div>
          ) : (
            <p className="text-center text-xs text-stone">
              {questionsReady ? 'Waiting for the host to start the game...' : 'The host is preparing the battle questions...'}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Lobby
  return (
    <div className="space-y-5 animate-fade-in max-w-3xl mx-auto">
      <SectionHeader title="The Arena" subtitle="Challenge other cadets to real-time quiz battles. Stake denarii, winner takes all." />

      <div className="card flex flex-col items-stretch justify-between gap-3 p-4 min-[460px]:flex-row min-[460px]:items-center">
        <div className="flex items-center gap-2">
          <Coins size={20} className="text-gold" />
          <span className="font-display font-bold text-gold text-lg">{formatDenarii(denarii)} Ð</span>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary w-full text-sm min-[460px]:w-auto">
          <Plus size={14} /> Create Room
        </button>
      </div>

      {error && <div className="p-3 rounded-lg bg-coral-soft text-coral text-sm">{error}</div>}

      {showCreate && (
        <div className="card space-y-3 p-4 animate-slide-up sm:p-5">
          <h4 className="font-display font-semibold text-ink">Create Arena Room</h4>
          <div>
            <label className="text-xs text-stone block mb-1">Room Name</label>
            <input className="input-field" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2">
            <div>
              <label className="text-xs text-stone block mb-1">Stake (denarii)</label>
              <input type="number" className="input-field" value={stake} min={10} onChange={(e) => setStake(parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <label className="text-xs text-stone block mb-1">Max Players</label>
              <input type="number" className="input-field" value={maxPlayers} min={2} max={8} onChange={(e) => setMaxPlayers(parseInt(e.target.value) || 4)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-stone block mb-1">Content Source (narrative date)</label>
            <select className="input-field" value={selectedNarrativeDate} onChange={(e) => setSelectedNarrativeDate(e.target.value)}>
              <option value="">Any / Latest</option>
              {narratives.map((n) => (
                <option key={n.narrative_date} value={n.narrative_date}>{n.narrative_date}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2">
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
            <label className="text-xs text-stone block mb-1.5">Tag Cadets <span className="text-stone/60">(optional — notify them to join)</span></label>
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
                  return (
                    <label key={cadet.user_id} className={cn('flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors', checked ? 'bg-gold-soft' : 'hover:bg-surface-3')}>
                      <input type="checkbox" checked={checked} onChange={() => {
                        setTaggedIds((prev) => {
                          const n = new Set(prev);
                          n.has(cadet.user_id) ? n.delete(cadet.user_id) : n.add(cadet.user_id);
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
          <button onClick={createRoom} disabled={creating || preparingQuestions || stake < 10 || stake + ARENA_GAME_CALL_FEE > denarii} className="btn-primary w-full text-sm">
            {(creating || preparingQuestions) ? <Loader2 size={14} className="animate-spin" /> : <Swords size={14} />}
            {preparingQuestions ? 'Building 19 Bible Questions...' : `Create & Stake ${formatDenarii(stake)} Ð`}
          </button>
          {stake + ARENA_GAME_CALL_FEE > denarii && <p className="text-xs text-coral">Insufficient denarii. You need {formatDenarii(stake + ARENA_GAME_CALL_FEE)} Ð (stake + {ARENA_GAME_CALL_FEE} game call fee).</p>}
          {stake + ARENA_GAME_CALL_FEE <= denarii && <p className="text-xs text-stone">A {ARENA_GAME_CALL_FEE} Ð game call fee is charged in addition to the stake.</p>}
        </div>
      )}

      <div className="space-y-2">
        <h4 className="font-display font-semibold text-ink text-sm">Open Rooms</h4>
        {rooms.filter((r) => r.status === 'waiting').length === 0 ? (
          <EmptyState icon={Swords} title="No open rooms" message="Create a room and invite other cadets to battle." />
        ) : (
          rooms.filter((r) => r.status === 'waiting').map((room) => {
            const participants = room.arena_participants || [];
            const isParticipant = participants.some((p: any) => p.user_id === profile?.id);
            const host = participants.find((p: any) => p.user_id === room.creator_id)?.profiles;
            const invited = Array.isArray(room.tagged_user_ids) && profile?.id ? room.tagged_user_ids.includes(profile.id) : false;
            const expiresAt = room.expires_at ? new Date(room.expires_at).getTime() : null;
            const minutesUntilExpiry = expiresAt && participants.length <= 1 ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000)) : null;
            const pot = room.stake_amount * participants.length;
            return (
              <div key={room.id} className="card flex flex-col items-stretch gap-3 p-4 min-[520px]:flex-row min-[520px]:items-center">
                <div className="w-10 h-10 rounded-lg bg-gold-soft flex items-center justify-center flex-shrink-0">
                  <Swords size={20} className="text-gold" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{room.room_name}</p>
                    {room.creator_id === profile?.id && <span className="badge badge-brass text-[9px]">Host</span>}
                    {invited && !isParticipant && <span className="badge badge-gold text-[9px]">Invited</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone">
                    <span className="flex items-center gap-0.5"><Coins size={11} /> {formatDenarii(room.stake_amount)} Ð</span>
                    <span className="flex items-center gap-0.5"><Trophy size={11} /> {formatDenarii(pot)} Ð pot</span>
                    <span className="flex items-center gap-0.5"><Users size={11} /> {participants.length}/{room.max_players}</span>
                    {host?.display_name && <span className="truncate">Host: {host.display_name}</span>}
                    {minutesUntilExpiry !== null && <span>{minutesUntilExpiry}m left</span>}
                  </div>
                </div>
                {isParticipant ? (
                  <button onClick={() => activateRoom(room.id, 'waiting')} className="btn-secondary w-full text-xs min-[520px]:w-auto">
                    Enter Room
                  </button>
                ) : (
                  <button onClick={() => joinRoom(room.id)} disabled={denarii < room.stake_amount || participants.length >= room.max_players}
                    className="btn-primary w-full text-xs disabled:opacity-40 min-[520px]:w-auto">
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
              <div key={room.id} className="card p-3 flex items-center gap-3 opacity-75">
                <Trophy size={16} className="text-gold flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-ink">{room.room_name}</p>
                  <p className="text-xs text-stone">Winner: {winner?.profiles?.display_name || '—'} · Pot: {formatDenarii(room.stake_amount * participants.length)} Ð</p>
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

const ARENA_ROUND_LENGTHS = [6, 6, 6, 1];
const ARENA_ROUND_SECONDS = [90, 72, 54, 10];
const ARENA_TOTAL_FIGS = 20;
const ARENA_GENERATOR_VERSION = 3;

function hasCurrentArenaQuestionSet(value: unknown): value is QuestionPayload[] {
  return Array.isArray(value)
    && value.length === 19
    && value.every((question) => (
      question
      && typeof question.question === 'string'
      && question.question.trim().length > 0
      && question.correct_answer !== undefined
      && question.generator_version === ARENA_GENERATOR_VERSION
      && typeof question.focus_key === 'string'
      && question.focus_key.trim().length > 0
    ));
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

function buildArenaQuestionSet(sourceQuestions: QuestionPayload[]) {
  const seen = new Set<string>();
  const focusKeys = new Set<string>();
  const cleaned = sourceQuestions.filter((q) => {
    if (!q.question || !q.correct_answer) return false;
    const key = normalizeArenaAnswer(q.question);
    const focusKey = normalizeArenaAnswer(q.focus_key || '');
    if (seen.has(key) || !focusKey || focusKeys.has(focusKey)) return false;
    seen.add(key);
    focusKeys.add(focusKey);
    return true;
  });
  if (cleaned.length < 19) return [];
  return cleaned.slice(0, 19).map((q, i) => ({
      ...q,
      game_round: getArenaRoundForIndex(i) + 1,
      round_timer_seconds: ARENA_ROUND_SECONDS[getArenaRoundForIndex(i)],
      is_bonus: i === 18,
    }));
}

function normalizeArenaAnswer(value: string | number | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

function isArenaAnswerCorrect(answer: string | null, question: QuestionPayload) {
  const acceptedAnswers = question.accepted_answers?.length
    ? question.accepted_answers
    : [String(question.correct_answer)];
  return acceptedAnswers.some((acceptedAnswer) => normalizeArenaAnswer(answer) === normalizeArenaAnswer(acceptedAnswer));
}

function ArenaGamePlay({ narrativeDate, roomName, startedAt, narratives, roomId, roomQuestionSet, onComplete, onExit }: {
  narrativeDate: string;
  roomName: string;
  startedAt: string | null;
  narratives: DailyNarrative[];
  roomId: string;
  roomQuestionSet?: QuestionPayload[] | null;
  onComplete: (score: number, correctCount: number) => void;
  onExit: () => void;
}) {
  const [questions, setQuestions] = useState<QuestionPayload[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [answeredIds, setAnsweredIds] = useState<Set<number>>(new Set());
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState(ARENA_ROUND_SECONDS[0]);
  const [ready, setReady] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationAttempt, setGenerationAttempt] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roundStartedAtRef = useRef(Date.now());
  const scoreRef = useRef(0);
  const correctCountRef = useRef(0);
  const completedRef = useRef(false);

  useEffect(() => { scoreRef.current = score; }, [score]);
  useEffect(() => { correctCountRef.current = correctCount; }, [correctCount]);

  const completeGame = useCallback((finalScore = scoreRef.current, finalCorrectCount = correctCountRef.current) => {
    if (completedRef.current) return;
    completedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    onComplete(finalScore, finalCorrectCount);
  }, [onComplete]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setReady(false);
      setGenerationError(null);
      if (hasCurrentArenaQuestionSet(roomQuestionSet)) {
        const prepared = buildArenaQuestionSet(roomQuestionSet);
        if (prepared.length === 19) {
          setQuestions(prepared);
          setReady(true);
          return;
        }
      }
      const topic = parseArenaTopic(roomName);
      const narrative = narrativeDate
        ? narratives.find((n) => n.narrative_date === narrativeDate)
        : narratives[0];
      try {
        const aiQuestions = await generateArenaQuestionsWithAI({
          roomId,
          roomName,
          topicType: topic?.type || 'narrative',
          topic: topic?.value || null,
          narrative: narrative || null,
          forceRegenerate: generationAttempt > 0 || !hasCurrentArenaQuestionSet(roomQuestionSet),
        });
        const prepared = buildArenaQuestionSet(aiQuestions);
        if (prepared.length !== 19) throw new Error('The generated battle did not contain 19 distinct questions.');
        if (!cancelled) {
          setQuestions(prepared);
          setReady(true);
        }
      } catch (e: any) {
        if (!cancelled) {
          setQuestions([]);
          setGenerationError(e.message || 'The arena could not prepare its Bible questions.');
          setReady(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [generationAttempt, narrativeDate, narratives, roomId, roomName, roomQuestionSet]);

  const handleAnswer = useCallback((answer: string | null) => {
    if (answeredIds.has(currentQ) || !questions[currentQ]) return;
    const q = questions[currentQ];
    const correct = isArenaAnswerCorrect(answer, q);
    const nextScore = correct ? scoreRef.current + (q.is_bonus ? 2 : 1) : scoreRef.current;
    const nextCorrectCount = correct ? correctCountRef.current + 1 : correctCountRef.current;
    setAnsweredIds((prev) => {
      const next = new Set(prev);
      next.add(currentQ);
      return next;
    });
    if (correct) {
      setScore(nextScore);
      setCorrectCount(nextCorrectCount);
    }
    const nextIndex = currentQ + 1;
    const currentRound = getArenaRoundForIndex(currentQ);
    if (nextIndex < questions.length && getArenaRoundForIndex(nextIndex) === currentRound) {
      setCurrentQ(nextIndex);
      setTypedAnswer('');
    } else if (nextIndex >= questions.length) {
      completeGame(nextScore, nextCorrectCount);
    }
  }, [answeredIds, questions, currentQ, completeGame]);

  const activeRoundIndex = getArenaRoundForIndex(currentQ);
  const moveToNextRound = useCallback(() => {
    const nextRoundQuestionIndex = ARENA_ROUND_LENGTHS
      .slice(0, activeRoundIndex + 1)
      .reduce((sum, length) => sum + length, 0);
    if (nextRoundQuestionIndex < questions.length) {
      setCurrentQ(nextRoundQuestionIndex);
      setTypedAnswer('');
    } else {
      completeGame();
    }
  }, [activeRoundIndex, completeGame, questions.length]);

  useEffect(() => {
    if (!ready || questions.length === 0) return;
    if (timerRef.current) clearInterval(timerRef.current);

    const configuredSeconds = ARENA_ROUND_SECONDS[activeRoundIndex];
    const roomStartMs = startedAt ? new Date(startedAt).getTime() : Number.NaN;
    roundStartedAtRef.current = activeRoundIndex === 0 && Number.isFinite(roomStartMs)
      ? roomStartMs
      : Date.now();

    const tick = () => {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - roundStartedAtRef.current) / 1000));
      const remaining = Math.max(0, configuredSeconds - elapsedSeconds);
      setTimeLeft(remaining);
      if (remaining === 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        moveToNextRound();
      }
    };

    tick();
    timerRef.current = setInterval(tick, 250);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [activeRoundIndex, moveToNextRound, questions.length, ready, startedAt]);

  if (!ready) return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <Loader2 size={28} className="animate-spin text-gold" />
      <div>
        <p className="font-display font-semibold text-ink">Preparing your Bible battle</p>
        <p className="mt-1 text-xs text-stone">Checking the source, uniqueness, and answer choices...</p>
      </div>
    </div>
  );

  if (questions.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-8 text-center">
        <div className="card space-y-4 p-5 sm:p-6">
          <XCircle size={30} className="mx-auto text-coral" />
          <div>
            <h3 className="font-display text-lg font-semibold text-ink">Questions need another attempt</h3>
            <p className="mt-1 text-sm leading-relaxed text-stone">
              {generationError || 'The arena could not produce a complete, non-repeating Bible set.'}
            </p>
          </div>
          <button type="button" onClick={() => setGenerationAttempt((attempt) => attempt + 1)} className="btn-primary w-full">
            <Zap size={16} /> Regenerate the Battle
          </button>
          <button type="button" onClick={onExit} className="btn-ghost w-full">Back to Arena</button>
        </div>
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

  return (
    <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onExit} className="btn-ghost px-3 text-sm">← Exit</button>
        <span className="badge badge-gold"><Zap size={12} /> Arena Battle</span>
        <div className={cn(
          'flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-1.5 font-display text-sm font-semibold',
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
        <span>Figs: <span className="text-ink font-semibold">{score}</span> / {ARENA_TOTAL_FIGS}</span>
        <span>Round {currentRound + 1}: <span className="text-ink font-semibold">{roundQuestionNumber}</span> / {ARENA_ROUND_LENGTHS[currentRound]}</span>
      </div>

      <div className="card p-4 sm:p-5">
        <p className="eyebrow mb-2">{q.is_bonus ? 'Bonus Question · 2 figs' : `Round ${currentRound + 1} · Question ${roundQuestionNumber}`}</p>
        <h3 className="preserve-paragraphs mb-4 text-base font-semibold leading-relaxed text-ink sm:text-lg">{q.question}</h3>

        {/* True/False */}
        {q.type === 'true_false' && (
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => handleAnswer('True')} disabled={isCurrentAnswered}
              className={cn('min-h-16 py-4 rounded-lg border-2 font-display font-bold text-lg transition-all',
                'border-sage hover:bg-sage-soft text-sage')}>
              <CheckCircle2 size={24} className="mx-auto mb-1" /> True
            </button>
            <button onClick={() => handleAnswer('False')} disabled={isCurrentAnswered}
              className={cn('min-h-16 py-4 rounded-lg border-2 font-display font-bold text-lg transition-all',
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
                <button key={i} onClick={() => handleAnswer(opt)} disabled={isCurrentAnswered}
                  className={cn('min-h-12 w-full rounded-lg border p-3.5 text-left text-sm font-medium leading-relaxed transition-all sm:text-base',
                    'border-border hover:border-gold text-ink')}>
                  {opt}
                </button>
              );
            })}
          </div>
        )}

        {/* Written-answer questions */}
        {(q.type === 'cloze' || q.type === 'scriptorium' || q.type === 'order_sequence' || q.type === 'matching' || q.type === 'standard_text') && (
          <div className="space-y-2">
            <input className="input-field" placeholder="Type your answer..." autoFocus
              value={typedAnswer}
              onChange={(e) => setTypedAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = typedAnswer.trim();
                  if (v) handleAnswer(v);
                }
              }} />
            <button className="btn-primary w-full" onClick={() => {
              const v = typedAnswer.trim();
              if (v) handleAnswer(v);
            }} disabled={!typedAnswer.trim() || isCurrentAnswered}>Submit</button>
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
    </div>
  );
}
