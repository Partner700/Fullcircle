import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, EmptyState } from '../../components/AppShell';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { AppSelect } from '../../components/AppSelect';
import { ArenaDieButton } from '../../components/ArenaDieButton';
import { ArenaMatchCountdown } from '../../components/ArenaMatchCountdown';
import { ArenaMatchup } from '../../components/ArenaMatchup';
import { ArenaFinalScorecard } from '../../components/ArenaFinalScorecard';
import { ArenaRecentResult } from '../../components/ArenaRecentResult';
import { InstructorArenaScheduler } from '../../components/InstructorArenaScheduler';
import { InstructorJourneyReview } from '../../components/InstructorJourneyReview';
import { ArenaRoomChat } from '../../components/ArenaRoomChat';
import { ArenaWitnessChatDrawer } from '../../components/ArenaWitnessChatDrawer';
import { ArenaChallengeGate } from '../../components/ArenaChallengeGate';
import { RoadHomeGame } from './RoadHomeGame';
import { JourneyGamePlay } from './JourneyGamePlay';
import { arenaGameOptions, preferredArenaGameType } from '../../lib/arenaJourneyRollout';
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
  fetchArenaLiveTriviaState,
  fetchPublicArenaTriviaFeed,
  fetchPublicArenaLiveState,
  publishArenaTriviaState,
  watchArenaRoom,
  heartbeatArenaViewer,
  leaveArenaRoomView,
  fetchArenaRooms,
  fetchArenaRoom,
  fetchArenaMatchups,
  fetchRhudeBoard,
  fetchArenaInvitees,
  prepareArenaQuestionDeck,
  fetchPanelImageSetting,
  respondArenaChatChallenge,
  joinInstructorArenaMatch,
  startScheduledArenaMatch,
  cancelInstructorArenaMatch,
} from '../../lib/queries';
import { playSoundEffect, setScenarioSound } from '../../lib/soundscape';
import { cn, formatDenarii } from '../../lib/utils';
import { ARENA_GAME_CALL_FEE } from '../../lib/constants';
import { activeArenaRoomStorageKey } from '../../lib/dailyGames';
import { safeJsonStorageGet, safeStorageGet, safeStorageRemove, safeStorageSet } from '../../lib/safeStorage';
import { UserAvatar } from '../../components/UserAvatar';
import type { QuestionPayload, Profile, RoleAssignment, PanelImageSetting } from '../../lib/types';
import type { ArenaChatGameCall, ArenaLiveTriviaState, ArenaTriviaFeedItem, ArenaViewer } from '../../lib/queries';
import type { ArenaMatchupPlayer } from '../../lib/arenaMatchup';
import {
  Swords, Coins, Loader2, Zap, Play, Plus, Clock, CheckCircle2, XCircle, UserPlus, Search, MessageCircle, Flag,
  ArrowLeft, ChevronDown, Eye, Radio, RotateCw, Share2, X,
} from 'lucide-react';

type ArenaPhase = 'lobby' | 'waiting' | 'playing' | 'finished';
type InvitePlayer = RoleAssignment & { profiles: Profile };
const dismissedArenaRoomsKey = (userId: string) => `full-circle-dismissed-arena-rooms-${userId}`;

function preserveDetailedArenaRooms(current: any[], latest: any[], activeRoomId: string | null) {
  const previous = new Map(current.map((room) => [room.id, room]));
  const merged = latest.map((room) => {
    const prior = previous.get(room.id);
    return prior && Object.prototype.hasOwnProperty.call(prior, 'question_set')
      ? { ...room, question_set: prior.question_set }
      : room;
  });
  if (activeRoomId && !merged.some((room) => room.id === activeRoomId) && previous.has(activeRoomId)) {
    merged.unshift(previous.get(activeRoomId));
  }
  return merged;
}

function upsertArenaRoom(current: any[], freshRoom: any) {
  const prior = current.find((room) => room.id === freshRoom.id);
  const room = prior && Object.prototype.hasOwnProperty.call(prior, 'question_set')
    && !Object.prototype.hasOwnProperty.call(freshRoom, 'question_set')
    ? { ...freshRoom, question_set: prior.question_set }
    : freshRoom;
  return [room, ...current.filter((item) => item.id !== freshRoom.id)];
}

interface CadetArenaProps {
  onBalanceChanged?: () => Promise<void> | void;
  onBackToDailyGames?: () => void;
  witnessOnly?: boolean;
  instructorSchedule?: boolean;
}

export function CadetArena({ onBalanceChanged, onBackToDailyGames, witnessOnly = false, instructorSchedule = false }: CadetArenaProps) {
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
  const [arenaGameType, setArenaGameType] = useState<'standard' | 'ludo' | 'journey'>('standard');
  const [journeyCharacters, setJourneyCharacters] = useState<Array<{ slug: string; displayName: string }>>([]);
  const [journeyCharacterSlug, setJourneyCharacterSlug] = useState('');
  const [journeyCatalogState, setJourneyCatalogState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [journeyCatalogRetry, setJourneyCatalogRetry] = useState(0);
  const [arenaDifficulty, setArenaDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [isSpectating, setIsSpectating] = useState(false);
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
  const previousSoundPhase = useRef<ArenaPhase | null>(null);
  const followingRestartRef = useRef<string | null>(null);
  const lastScheduledStartAttempt = useRef(0);
  const activeRoomIdRef = useRef(activeRoomId);
  const hydratingRoomRef = useRef<string | null>(null);
  activeRoomIdRef.current = activeRoomId;
  const hasLiveRooms = rooms.some((room) => room.status === 'playing');
  const liveRoomIds = rooms.filter((room) => room.status === 'playing').map((room) => room.id).join(',');

  useEffect(() => {
    void setScenarioSound(phase === 'playing' ? 'sound_game_level_1' : phase === 'lobby' || phase === 'waiting' ? 'sound_arena_lobby' : null);
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
    const savedRoomId = safeStorageGet('local', activeArenaRoomStorageKey(profile.id));
    const dismissed = new Set(safeJsonStorageGet<string[]>('local', dismissedArenaRoomsKey(profile.id), []));
    if (savedRoomId && !dismissed.has(savedRoomId)) setActiveRoomId(savedRoomId);
    if (savedRoomId && dismissed.has(savedRoomId)) safeStorageRemove('local', activeArenaRoomStorageKey(profile.id));
  }, [profile]);

  useEffect(() => {
    if (!profile || !activeRoomId || isSpectating) return;
    safeStorageSet('local', activeArenaRoomStorageKey(profile.id), activeRoomId);
  }, [profile, activeRoomId, isSpectating]);

  const clearActiveRoom = useCallback((dismiss = false) => {
    if (profile && activeRoomId) {
      if (isSpectating) {
        void leaveArenaRoomView(activeRoomId).catch(() => null);
      } else {
        safeStorageRemove('local', activeArenaRoomStorageKey(profile.id));
      }
      if (dismiss && !isSpectating) {
        const key = dismissedArenaRoomsKey(profile.id);
        const dismissed = new Set(safeJsonStorageGet<string[]>('local', key, []));
        dismissed.add(activeRoomId);
        safeStorageSet('local', key, JSON.stringify(Array.from(dismissed).slice(-20)));
      }
    }
    setActiveRoomId(null);
    setIsSpectating(false);
    setPhase('lobby');
  }, [activeRoomId, isSpectating, profile]);

  const activateRoom = useCallback((roomId: string, nextPhase: ArenaPhase = 'waiting') => {
    if (profile) {
      const dismissedKey = dismissedArenaRoomsKey(profile.id);
      const dismissed = new Set(safeJsonStorageGet<string[]>('local', dismissedKey, []));
      dismissed.delete(roomId);
      safeStorageSet('local', dismissedKey, JSON.stringify(Array.from(dismissed)));
      safeStorageSet('local', activeArenaRoomStorageKey(profile.id), roomId);
    }
    setIsSpectating(false);
    setActiveRoomId(roomId);
    setPhase(nextPhase);
  }, [profile]);

  const refreshRooms = useCallback(async () => {
    try {
      const latest = await fetchArenaRooms();
      setRooms((current) => preserveDetailedArenaRooms(current, latest, activeRoomIdRef.current));
    } catch (refreshError) { console.error('Arena room refresh failed:', refreshError); }
  }, []);

  const refreshRoom = useCallback(async (roomId: string) => {
    try {
      const freshRoom = await fetchArenaRoom(roomId);
      if (!freshRoom) return null;
      setRooms((current) => upsertArenaRoom(current, freshRoom));
      return freshRoom;
    } catch {
      return null;
    }
  }, []);

  const watchRoom = useCallback(async (roomId: string, roomStatus: 'waiting' | 'playing' = 'playing') => {
    if (!profile) return false;
    setError(null);
    try {
      if (!await watchArenaRoom(roomId)) throw new Error('This Arena match has ended and cannot be witnessed.');
      const freshRoom = await refreshRoom(roomId);
      if (freshRoom && !isWitnessableArenaRoom(freshRoom)) {
        await leaveArenaRoomView(roomId).catch(() => undefined);
        throw new Error('This Arena match has ended and cannot be witnessed.');
      }
      setIsSpectating(true);
      setActiveRoomId(roomId);
      setPhase((freshRoom?.status || roomStatus) === 'waiting' ? 'waiting' : 'playing');
      return true;
    } catch (watchError: any) {
      setError(watchError?.message || 'This live Arena match could not be witnessed.');
      return false;
    }
  }, [profile, refreshRoom]);

  const load = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    try {
      const [roomsData, balance, invitees, panelImage] = await Promise.allSettled([
        fetchArenaRooms(),
        witnessOnly ? Promise.resolve(0) : fetchLedgerTotal(profile.id),
        witnessOnly ? Promise.resolve([] as InvitePlayer[]) : fetchArenaInvitees(),
        fetchPanelImageSetting('arena'),
      ]);
      if (roomsData.status === 'fulfilled') {
        setRooms((current) => preserveDetailedArenaRooms(current, roomsData.value, activeRoomIdRef.current));
      }
      setDenarii(balance.status === 'fulfilled' ? balance.value : 0);
      setAllInvitees((invitees.status === 'fulfilled' ? invitees.value : []).filter((c) => c.user_id !== profile.id));
      setArenaImage(panelImage.status === 'fulfilled' ? panelImage.value : null);
    } catch (e) {
      console.error('Arena load error:', e);
    } finally {
      setLoading(false);
    }
  }, [profile, witnessOnly]);

  const hydrateActiveRoom = useCallback(async (roomId: string) => {
    if (hydratingRoomRef.current === roomId) return;
    hydratingRoomRef.current = roomId;
    try {
      const detailedRoom = await fetchArenaRoom(roomId, true);
      if (!detailedRoom) throw new Error('That Arena match could not be found.');
      if (activeRoomIdRef.current === roomId) {
        setRooms((current) => upsertArenaRoom(current, detailedRoom));
        setError(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The Arena questions could not load.');
    } finally {
      hydratingRoomRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!activeRoomId || phase !== 'playing' || isSpectating) return;
    const room = rooms.find((item) => item.id === activeRoomId);
    if (room && parseArenaGameType(room.room_name) !== 'standard') return;
    if (room && Object.prototype.hasOwnProperty.call(room, 'question_set')) return;
    void hydrateActiveRoom(activeRoomId);
  }, [activeRoomId, hydrateActiveRoom, isSpectating, phase, rooms]);

  const shareRoom = useCallback(async (roomId: string) => {
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set('share', 'arena');
    url.searchParams.set('id', roomId);
    try {
      if (navigator.share) await navigator.share({ title: 'Witness a Full Circle Arena match', url: url.toString() });
      else await navigator.clipboard.writeText(url.toString());
    } catch (shareError) {
      if ((shareError as Error)?.name !== 'AbortError') setError('The Arena link could not be shared.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!profile || !showCreate || arenaOpponent === 'machine') return;
    let active = true;
    setJourneyCatalogState('loading');
    void supabase.rpc('list_ready_arena_journey_characters').then(({ data, error: catalogError }) => {
      if (!active) return;
      if (catalogError) {
        setJourneyCatalogState('error');
        return;
      }
      const catalog = (data || []) as Array<{ slug: string; displayName: string }>;
      setJourneyCharacters(catalog);
      setJourneyCharacterSlug((current) => catalog.some((item) => item.slug === current) ? current : catalog[0]?.slug || '');
      setArenaGameType((current) => preferredArenaGameType(current, arenaOpponent, catalog.length));
      setJourneyCatalogState('ready');
    }, () => {
      if (active) setJourneyCatalogState('error');
    });
    return () => { active = false; };
  }, [profile, showCreate, arenaOpponent, journeyCatalogRetry]);

  const handleGameCallCreated = useCallback(async (gameCall: ArenaChatGameCall) => {
    if (!gameCall.challenged_user_id) activateRoom(gameCall.target_room_id, 'waiting');
    await Promise.all([load(), Promise.resolve(onBalanceChanged?.())]);
  }, [activateRoom, load, onBalanceChanged]);

  const handleGameCallAction = useCallback(async (gameCall: ArenaChatGameCall) => {
    if (!profile) return;
    let targetRoom = await fetchArenaRoom(gameCall.target_room_id);
    if (!targetRoom || ['completed', 'cancelled', 'expired'].includes(targetRoom.status)) {
      throw new Error('That game call is no longer open.');
    }

    const alreadyPlaying = (targetRoom.arena_participants || []).some((participant: any) => (
      participant.user_id === profile.id && !participant.forfeited_at
    ));
    if (alreadyPlaying) {
      activateRoom(targetRoom.id, targetRoom.status === 'playing' ? 'playing' : 'waiting');
      await load();
      return;
    }

    if (gameCall.challenged_user_id) {
      if (gameCall.challenged_user_id === profile.id) {
        throw new Error('Answer this challenge from the decision shown in your current match.');
      }
      if (targetRoom.status === 'waiting' || targetRoom.status === 'playing') {
        const watching = await watchRoom(targetRoom.id, targetRoom.status);
        if (!watching) throw new Error('That challenge could not be opened as a witness.');
        return;
      }
      throw new Error('That Arena challenge is no longer open.');
    }

    const activePlayers = (targetRoom.arena_participants || []).filter((participant: any) => !participant.forfeited_at);
    if (targetRoom.status === 'waiting' && activePlayers.length < targetRoom.max_players) {
      try {
        await joinArenaRoom(targetRoom.id, profile.id);
        activateRoom(targetRoom.id, 'waiting');
        await Promise.all([load(), Promise.resolve(onBalanceChanged?.())]);
        return;
      } catch (joinError) {
        targetRoom = await fetchArenaRoom(targetRoom.id);
        const refreshedPlayers = (targetRoom?.arena_participants || []).filter((participant: any) => !participant.forfeited_at);
        const becameWatchOnly = targetRoom
          && (targetRoom.status === 'playing' || (targetRoom.status === 'waiting' && refreshedPlayers.length >= targetRoom.max_players));
        if (!becameWatchOnly) throw joinError;
      }
    }

    if (targetRoom?.status === 'waiting' || targetRoom?.status === 'playing') {
      const watching = await watchRoom(targetRoom.id, targetRoom.status);
      if (!watching) throw new Error('That game could not be opened as a witness.');
      return;
    }
    throw new Error('That game call is no longer open.');
  }, [activateRoom, load, onBalanceChanged, profile, watchRoom]);

  const startScheduledChallenge = useCallback(async (targetRoomId: string) => {
    setError(null);
    try {
      const roomId = await respondArenaChatChallenge(targetRoomId, 'accept');
      activateRoom(roomId, 'playing');
      await Promise.all([load(), Promise.resolve(onBalanceChanged?.())]);
    } catch (responseError: any) {
      setError(responseError?.message || 'That scheduled Arena challenge could not be started.');
    }
  }, [activateRoom, load, onBalanceChanged]);

  const handleAcceptedChallenge = useCallback(async (targetRoomId: string) => {
    activateRoom(targetRoomId, 'playing');
    await Promise.all([load(), Promise.resolve(onBalanceChanged?.())]);
  }, [activateRoom, load, onBalanceChanged]);

  useEffect(() => {
    if (!profile || phase !== 'lobby') return;
    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => { void refreshRooms(); }, 180);
    };
    const channel = supabase
      .channel(`arena_lobby_${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arena_rooms' }, scheduleRefresh)
      .subscribe();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshRooms();
    }, hasLiveRooms ? 15_000 : 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshRooms(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
  }, [phase, profile, refreshRooms, hasLiveRooms]);

  useEffect(() => {
    if (phase !== 'lobby' || !liveRoomIds) return;
    let active = true;
    const refreshScores = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const scores = await fetchArenaMatchups(liveRoomIds.split(','));
        if (active) setRooms((current) => current.map((room) => {
          const players = scores.get(room.id);
          return players ? { ...room, arena_matchup_players: players } : room;
        }));
      } catch { /* The regular Arena refresh will retry. */ }
    };
    const interval = window.setInterval(() => { void refreshScores(); }, 5_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [phase, liveRoomIds]);

  // Realtime subscription for room updates
  useEffect(() => {
    if (!activeRoomId) return;
    const channel = supabase
      .channel(`arena_room_${activeRoomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arena_participants', filter: `room_id=eq.${activeRoomId}` },
        () => { void refreshRoom(activeRoomId); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arena_viewers', filter: `room_id=eq.${activeRoomId}` },
        () => { void refreshRoom(activeRoomId); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arena_rooms', filter: `id=eq.${activeRoomId}` },
        () => { void refreshRoom(activeRoomId); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [activeRoomId, refreshRoom]);

  useEffect(() => {
    if (!profile || !activeRoomId || phase !== 'playing' || isSpectating) return;
    let cancelled = false;
    const heartbeat = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const active = await heartbeatArenaParticipant(activeRoomId, profile.id);
        if (!active && !cancelled) {
          const freshRoom = await fetchArenaRoom(activeRoomId).catch(() => null);
          if (freshRoom?.status === 'completed') {
            setRooms((prev) => upsertArenaRoom(prev, freshRoom));
            if (!freshRoom.restarted_as_room_id) setPhase('finished');
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
  }, [activeRoomId, clearActiveRoom, isSpectating, phase, profile]);

  useEffect(() => {
    if (!profile || !activeRoomId || !['waiting', 'playing'].includes(phase) || !isSpectating) return;
    let cancelled = false;
    const heartbeat = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const active = await heartbeatArenaViewer(activeRoomId);
        if (!active && !cancelled) {
          const freshRoom = await refreshRoom(activeRoomId);
          if (freshRoom?.status === 'completed') {
            if (!freshRoom.restarted_as_room_id) setPhase('finished');
            setError(null);
            return;
          }
          if (freshRoom && isWitnessableArenaRoom(freshRoom)) {
            const rejoined = await watchArenaRoom(activeRoomId).catch(() => false);
            if (rejoined) {
              setError(null);
              return;
            }
          }
          if (freshRoom && !isWitnessableArenaRoom(freshRoom)) {
            setError('That Arena match has ended.');
            clearActiveRoom(false);
          }
          return;
        }
        await refreshRoom(activeRoomId);
      } catch { /* Realtime and the next heartbeat will retry. */ }
    };
    void heartbeat();
    const interval = window.setInterval(() => { void heartbeat(); }, 25_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') void heartbeat(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [activeRoomId, clearActiveRoom, isSpectating, phase, profile, refreshRoom]);

  useEffect(() => {
    if (!activeRoomId || !isSpectating) return;
    return () => { void leaveArenaRoomView(activeRoomId).catch(() => null); };
  }, [activeRoomId, isSpectating]);

  useEffect(() => {
    if (!activeRoomId) return;
    const room = rooms.find((r) => r.id === activeRoomId);
    if (!room) {
      void refreshRoom(activeRoomId);
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
    if (room.status === 'completed' && room.restarted_as_room_id) {
      const restartedRoomId = String(room.restarted_as_room_id);
      if (followingRestartRef.current !== restartedRoomId) {
        followingRestartRef.current = restartedRoomId;
        void fetchArenaRoom(restartedRoomId)
          .then(async (restartedRoom) => {
            if (!restartedRoom || !profile) return;
            setRooms((current) => upsertArenaRoom(current, restartedRoom));
            const isRestartedPlayer = (restartedRoom.arena_participants || []).some((participant: any) => (
              participant.user_id === profile.id && !participant.forfeited_at
            ));
            if (isRestartedPlayer) {
              activateRoom(restartedRoomId, 'playing');
              await load();
              return;
            }
            await watchRoom(restartedRoomId, 'playing');
          })
          .catch(() => { followingRestartRef.current = null; });
      }
      return;
    }
    if (room.status === 'completed') {
      if (isSpectating) {
        if (phase !== 'finished') {
          setPhase('finished');
        }
      } else if (parseArenaGameType(room.room_name || '') === 'ludo' && room.completion_reason !== 'forfeit') {
        if (phase !== 'playing') setPhase('playing');
      } else if (phase !== 'finished') {
        setPhase('finished');
        if (profile && !isSpectating) safeStorageRemove('local', activeArenaRoomStorageKey(profile.id));
      }
    }
    const myParticipant = (room.arena_participants || []).find((participant: any) => participant.user_id === profile?.id);
    if (!isSpectating && myParticipant?.forfeited_at && room.status === 'playing') {
      setError(myParticipant.forfeit_reason === 'inactive'
        ? 'You were away from this Arena match for three minutes and forfeited your place.'
        : 'You forfeited this Arena match.');
      clearActiveRoom(true);
    }
  }, [activeRoomId, activateRoom, phase, rooms, profile, clearActiveRoom, isSpectating, load, refreshRoom, watchRoom]);

  useEffect(() => {
    if (!activeRoomId || phase !== 'waiting') return;
    let cancelled = false;
    const refreshActiveRoom = async () => {
      try {
        const freshRoom = await fetchArenaRoom(activeRoomId);
        if (cancelled || !freshRoom) return;
        setRooms((prev) => upsertArenaRoom(prev, freshRoom));
        if (freshRoom.status === 'playing') setPhase('playing');
        if (['cancelled', 'expired'].includes(freshRoom.status)) clearActiveRoom(false);
        if (freshRoom.status === 'waiting' && freshRoom.scheduled && !isSpectating && profile
          && Date.now() >= Date.parse(freshRoom.scheduled_start_at)
          && (freshRoom.arena_participants || []).filter((participant: any) => !participant.forfeited_at).length >= 2
          && (freshRoom.arena_participants || []).some((participant: any) => participant.user_id === profile.id && !participant.forfeited_at)
          && Date.now() - lastScheduledStartAttempt.current > 8000) {
          lastScheduledStartAttempt.current = Date.now();
          await startScheduledArenaMatch(activeRoomId);
          if (!cancelled) setPhase('playing');
        }
      } catch {
        // Realtime/polling will try again; keep the waiting room mounted.
      }
    };
    void refreshActiveRoom();
    const interval = window.setInterval(() => { void refreshActiveRoom(); }, isSpectating ? 8_000 : 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeRoomId, clearActiveRoom, isSpectating, phase, profile]);

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
    if (arenaOpponent === 'players' && journeyCatalogState !== 'ready') {
      setError('The match list is still loading. Try again once it is ready.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      if (arenaGameType === 'journey' && (arenaOpponent === 'machine' || !journeyCharacters.some((item) => item.slug === journeyCharacterSlug))) {
        throw new Error('Choose a ready Biblical Journey character and other players.');
      }
      const difficultySuffix = arenaOpponent === 'machine' ? ` [difficulty:${arenaDifficulty}]` : '';
      const characterSuffix = arenaGameType === 'journey' ? ` [character:${journeyCharacterSlug}]` : '';
      const fullRoomName = `${roomName} [arena:${arenaGameType}]${characterSuffix}${difficultySuffix}`;
      const roomId = arenaOpponent === 'machine'
        ? await createMachineArenaRoom(profile.id, fullRoomName)
        : await createArenaRoom(profile.id, fullRoomName, stake, arenaGameType === 'journey' ? Math.min(maxPlayers, 4) : maxPlayers, undefined, Array.from(taggedIds));
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
      const selectedRoom = rooms.find((room) => room.id === roomId);
      if (selectedRoom?.scheduled) await joinInstructorArenaMatch(roomId);
      else await joinArenaRoom(roomId, profile.id);
      activateRoom(roomId, 'waiting');
      await load();
      await onBalanceChanged?.();
    } catch (e: any) { setError(e.message || 'Failed to join room'); }
  };

  const cancelScheduledRoom = async (roomId: string) => {
    try {
      await cancelInstructorArenaMatch(roomId);
      await refreshRooms();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'The match could not be cancelled.');
    }
  };

  const startGame = async () => {
    if (!profile || !activeRoomId) return;
    setStarting(true);
    setError(null);
    try {
      const selectedRoom = rooms.find((room) => room.id === activeRoomId);
      if (selectedRoom?.scheduled) await startScheduledArenaMatch(activeRoomId);
      else await startArenaRoom(activeRoomId, profile.id);
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
    const witnesses = (activeRoom?.arena_viewers || []) as ArenaViewer[];
    if (!isSpectating && (!activeRoom || (parseArenaGameType(activeRoomName) === 'standard'
      && !Object.prototype.hasOwnProperty.call(activeRoom, 'question_set')))) {
      return <div className="flex min-h-[24rem] flex-col items-center justify-center gap-3 text-center">
        {error ? <><p className="text-sm text-coral">{error}</p><button type="button" className="btn-secondary text-xs" onClick={() => void hydrateActiveRoom(activeRoomId)}><RotateCw size={14} /> Try again</button></>
          : <><Loader2 size={24} className="animate-spin text-brass" /><p className="text-sm text-stone">Opening the match...</p></>}
      </div>;
    }
    if (isSpectating && !activeRoom) {
      return <div className="flex min-h-[24rem] flex-col items-center justify-center gap-3"><Loader2 size={24} className="animate-spin text-brass" /><p className="text-sm text-stone">Opening the live Arena...</p></div>;
    }
    if (parseArenaGameType(activeRoomName) === 'journey') {
      return <div className="space-y-4">
        <div className="flex justify-end"><button type="button" className="btn-secondary text-xs" onClick={() => void shareRoom(activeRoomId)}><Share2 size={14} /> Share match</button></div>
        <JourneyGamePlay key={activeRoomId} roomId={activeRoomId} roomName={activeRoomName}
          userId={profile!.id} players={arenaMatchupPlayers(activeRoom)} spectator={isSpectating}
          onExit={() => clearActiveRoom(!isSpectating)}
          onStateChanged={async () => { await load(); await onBalanceChanged?.(); }} />
        <ArenaWitnessStrip witnesses={witnesses} guestCount={Number(activeRoom?.arena_guest_witness_count) || 0} />
        {!isSpectating && <ArenaChallengeGate roomId={activeRoomId} userId={profile!.id} onAccepted={handleAcceptedChallenge} />}
      </div>;
    }
    if (parseArenaGameType(activeRoomName) === 'ludo') {
      return (
        <div className="space-y-4">
          <div className="flex justify-end"><button type="button" className="btn-secondary text-xs" onClick={() => void shareRoom(activeRoomId)}><Share2 size={14} /> Share match</button></div>
          <RoadHomeGame
            key={activeRoomId}
            roomId={activeRoomId}
            roomName={activeRoomName}
            userId={profile!.id}
            spectator={isSpectating}
            awaitSeriesResult={Boolean(activeRoom?.scheduled && activeRoom.play_mode !== 'machine' && activeRoom.max_players <= 4)}
            spectatorCanChallenge={!witnessOnly}
            onGameCallCreated={handleGameCallCreated}
            onGameCallAction={handleGameCallAction}
            prepareQuestions={isSpectating ? undefined : async () => {
              const generated = await prepareArenaQuestionDeck({
                roomId: activeRoomId,
              });
              if (!generated.length) throw new Error('The Arena question deck is empty.');
            }}
            onExit={() => clearActiveRoom(!isSpectating)}
            onStateChanged={async () => {
              await load();
              await onBalanceChanged?.();
            }}
          />
          <ArenaWitnessStrip witnesses={witnesses} guestCount={Number(activeRoom?.arena_guest_witness_count) || 0} />
          {!isSpectating && (
            <ArenaChallengeGate roomId={activeRoomId} userId={profile!.id} onAccepted={handleAcceptedChallenge} />
          )}
        </div>
      );
    }
    if (isSpectating) {
      return (
        <div className="space-y-4">
          <div className="flex justify-end"><button type="button" className="btn-secondary text-xs" onClick={() => void shareRoom(activeRoomId)}><Share2 size={14} /> Share match</button></div>
          <ArenaStandardSpectator
            room={activeRoom}
            userId={profile!.id}
            onExit={() => clearActiveRoom(false)}
            allowChallenges={!witnessOnly}
            onGameCallCreated={handleGameCallCreated}
            onGameCallAction={handleGameCallAction}
          />
          <ArenaWitnessStrip witnesses={witnesses} guestCount={Number(activeRoom?.arena_guest_witness_count) || 0} />
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <div className="flex justify-end"><button type="button" className="btn-secondary text-xs" onClick={() => void shareRoom(activeRoomId)}><Share2 size={14} /> Share match</button></div>
        <ArenaGamePlay
          roomName={activeRoom?.room_name || roomName}
          roomId={activeRoomId}
          userId={profile!.id}
          roomQuestionSet={activeRoom?.question_set}
          onComplete={async (score, correctCount) => {
            let finishedRoom = null;
            try {
              await finishArenaGame(activeRoomId, profile!.id, score, correctCount);
            } catch (finishError) {
              finishedRoom = await fetchArenaRoom(activeRoomId).catch(() => null);
              if (finishedRoom?.status !== 'completed') throw finishError;
            }
            finishedRoom ||= await fetchArenaRoom(activeRoomId).catch(() => null);
            if (finishedRoom) setRooms((prev) => upsertArenaRoom(prev, finishedRoom));
            if (finishedRoom?.status === 'completed' && !finishedRoom.restarted_as_room_id) setPhase('finished');
            try { await onBalanceChanged?.(); } catch { /* The match result is already settled. */ }
          }}
          onForfeit={forfeitStandardMatch}
          forfeiting={forfeiting}
          onExit={() => clearActiveRoom(true)}
          onGameCallAction={handleGameCallAction}
        />
        <ArenaWitnessStrip witnesses={witnesses} guestCount={Number(activeRoom?.arena_guest_witness_count) || 0} />
        <ArenaChallengeGate roomId={activeRoomId} userId={profile!.id} onAccepted={handleAcceptedChallenge} />
      </div>
    );
  }

  if (phase === 'finished' && activeRoomId) {
    return <ArenaFinalScorecard roomId={activeRoomId} arenaImage={arenaImage} onExit={() => clearActiveRoom(true)} />;
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
    const witnesses = (room?.arena_viewers || []) as ArenaViewer[];
    const isCreator = room?.creator_id === profile?.id;
    const machineMatch = room?.play_mode === 'machine';
    const scheduleReady = !room?.scheduled_start_at || Date.now() >= Date.parse(room.scheduled_start_at);
    const canStart = scheduleReady && (machineMatch || participants.length >= 2);
    const availableInvitees = allInvitees.filter((player) => !participants.some((p: any) => p.user_id === player.user_id));

    return (
      <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <button onClick={() => clearActiveRoom(true)} className="btn-ghost text-sm">← Back</button>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost h-8 w-8 p-0" title="Share Arena room" aria-label="Share Arena room" onClick={() => void shareRoom(room.id)}><Share2 size={15} /></button>
            <span className="badge badge-gold"><Clock size={12} /> Waiting Room</span>
          </div>
        </div>

        {error && <div className="p-3 rounded-lg bg-coral-soft text-coral text-sm">{error}</div>}

        <div data-artwork-theme={(arenaImage)?.url ? 'night' : undefined} className="card relative overflow-hidden p-5">
          <PanelImageBackdrop image={arenaImage} opacityFallback={24} veilClassName="arena-panel-veil" />
          <div className="relative z-10">
          <h3 className="mb-3 text-center font-display text-lg font-semibold text-ink">{cleanArenaRoomName(room?.room_name || 'Arena Room')}</h3>
          <div className="mb-3"><ArenaMatchup players={arenaMatchupPlayers(room)} /></div>
          {room?.scheduled_start_at && <ArenaMatchCountdown startsAt={room.scheduled_start_at} />}

          {!machineMatch && (
            <ArenaRoomChat
              roomId={room.id}
              userId={profile!.id}
              onGameCallAction={isSpectating ? handleGameCallAction : undefined}
            />
          )}

          {isCreator && !machineMatch && !room?.scheduled && (
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
                          <UserAvatar userId={player.user_id} name={player.profiles?.display_name} avatarUrl={player.profiles?.avatar_url} className="h-full w-full border border-border" />

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

          {isSpectating ? (
            <div className="space-y-3">
              <ArenaWitnessStrip witnesses={witnesses} guestCount={Number(room?.arena_guest_witness_count) || 0} />
            </div>
          ) : isCreator || room?.scheduled ? (
            <div className="grid sm:grid-cols-2 gap-2">
              <button onClick={startGame} disabled={!canStart || starting} className="btn-primary w-full disabled:opacity-50">
                {starting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {canStart ? 'Start Game' : !scheduleReady ? 'Countdown running' : 'Waiting for players...'}
              </button>
              {!room?.scheduled && <button onClick={closeRoom} disabled={closing} className="btn-secondary w-full text-coral disabled:opacity-50">
                {closing ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
                Close Room
              </button>}
            </div>
          ) : (
            <p className="text-xs text-stone text-center">{room?.scheduled ? 'The match will start after the countdown when two players are here.' : 'Waiting for the host to start the game...'}</p>
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
      <div data-artwork-theme={(arenaImage)?.url ? 'night' : undefined} className="card relative overflow-hidden p-4 sm:p-5">
        <PanelImageBackdrop image={arenaImage} opacityFallback={22} veilClassName="arena-panel-veil" />
        <div className="relative z-10">
          <SectionHeader
            title={witnessOnly ? 'Arena Witness' : 'The Arena'}
            subtitle={witnessOnly
              ? 'Witness live Arena matches.'
              : 'Challenge cadets and sentries to real-time quiz battles. Stake denarii, winner takes all.'}
          />
        </div>
      </div>

      {!witnessOnly && <div className="card p-4">
        <div className="flex items-center gap-2">
          <Coins size={20} className="text-gold" />
          <div>
            <p className="eyebrow text-stone">Available Denarii</p>
            <span className="font-display font-bold text-gold text-xl">{formatDenarii(denarii)} Ð</span>
          </div>
        </div>
      </div>}

      {instructorSchedule && <>
        <InstructorArenaScheduler onScheduled={refreshRooms} />
        <InstructorJourneyReview />
      </>}

      {!witnessOnly && <div className="card p-4 sm:p-5">
        <p className="eyebrow text-stone">Arena Match</p>
        <h3 className="mt-1 font-display text-base font-semibold text-ink">Choose your battle, then create one room.</h3>
        <p className="mt-1 text-xs leading-relaxed text-stone">Play the machine or invite people. Both use the same match setup and the same tenfold prize rule.</p>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary mt-4 w-full sm:w-auto text-sm">
          <Plus size={14} /> {showCreate ? 'Close Match Setup' : 'Create Arena Match'}
        </button>
      </div>}

      {error && <div className="p-3 rounded-lg bg-coral-soft text-coral text-sm">{error}</div>}

      {!witnessOnly && showCreate && (
        <div className="card p-5 space-y-3 animate-slide-up">
          <h4 className="font-display font-semibold text-ink">Create Arena Match</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-stone block mb-1">Opponent</label>
              <AppSelect value={arenaOpponent} onChange={(value) => {
                const opponent = value as 'players' | 'machine';
                setArenaOpponent(opponent);
                setArenaGameType((current) => preferredArenaGameType(current, opponent, journeyCharacters.length));
              }} options={[{ value: 'players', label: 'Other players' }, { value: 'machine', label: 'Machine' }]} />
            </div>
            <div>
              <label className="text-xs text-stone block mb-1">Game Play</label>
              <AppSelect value={arenaGameType} onChange={(value) => {
                setArenaGameType(value as 'standard' | 'ludo' | 'journey');
                if (value !== 'standard') setMaxPlayers((current) => Math.min(current, 4));
              }} options={arenaGameOptions(arenaOpponent, journeyCharacters.length)} />
            </div>
          </div>
          {arenaOpponent === 'players' && journeyCatalogState === 'loading' && (
            <p className="text-xs text-stone" role="status">Checking available games...</p>
          )}
          {arenaOpponent === 'players' && journeyCatalogState === 'error' && (
            <div className="flex items-center gap-2 text-xs text-coral" role="alert">
              <span>The game list could not load.</span>
              <button type="button" className="underline" onClick={() => setJourneyCatalogRetry((current) => current + 1)}>Try Again</button>
            </div>
          )}
          {arenaGameType === 'journey' && <div>
            <label className="text-xs text-stone block mb-1">Biblical character</label>
            <AppSelect value={journeyCharacterSlug} onChange={setJourneyCharacterSlug} options={journeyCharacters.map((item) => ({ value: item.slug, label: item.displayName }))} />
          </div>}
          {arenaOpponent === 'machine' && <div>
            <label className="text-xs text-stone block mb-1">Machine Difficulty</label>
            <AppSelect value={arenaDifficulty} onChange={(value) => setArenaDifficulty(value as 'easy' | 'medium' | 'hard')} options={[
              { value: 'easy', label: 'Easy', description: 'Slower and less accurate' },
              { value: 'medium', label: 'Medium', description: 'Balanced' },
              { value: 'hard', label: 'Hard', description: 'Fast and highly accurate' },
            ]} />
          </div>}
          <p className="rounded-lg border border-brass/25 bg-brass-soft p-3 text-xs text-stone">
            {arenaGameType === 'standard' ? 'Classic Trivia: answer questions from previous Weekly and Fortune quizzes; the highest figs win.'
              : arenaGameType === 'journey' ? 'Standard Trivia: The Biblical Journey.'
                : 'Ludo Trivia: previous Weekly and Fortune quiz questions move tokens around the board, with surprise spaces and relic effects.'}
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
              <input type="number" className="input-field" value={maxPlayers - 1} min={1} max={arenaGameType === 'standard' ? 7 : 3} onChange={(e) => {
                const opponents = Math.max(1, Math.min(arenaGameType === 'standard' ? 7 : 3, parseInt(e.target.value) || 1));
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
                        <UserAvatar userId={player.user_id} name={player.profiles?.display_name} avatarUrl={player.profiles?.avatar_url} className="h-full w-full" />

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
          <button onClick={createRoom} disabled={creating || (arenaOpponent === 'players' && journeyCatalogState !== 'ready') || (arenaOpponent === 'machine' ? denarii < 50 : stake < 10 || stake + ARENA_GAME_CALL_FEE > denarii)} className="btn-primary text-sm">
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Swords size={14} />} {arenaOpponent === 'machine' ? 'Create Machine Match · 50 Ð' : `Create & Stake ${formatDenarii(stake)} Ð`}
          </button>
          {arenaOpponent === 'machine' ? <p className="text-xs text-stone">Machine matches charge only the fixed 50 Ð stake.</p> : <>
            {stake + ARENA_GAME_CALL_FEE > denarii && <p className="text-xs text-coral">Insufficient denarii. You need {formatDenarii(stake + ARENA_GAME_CALL_FEE)} Ð (stake + {ARENA_GAME_CALL_FEE} game call fee).</p>}
            {stake + ARENA_GAME_CALL_FEE <= denarii && <p className="text-xs text-stone">A {ARENA_GAME_CALL_FEE} Ð game call fee is charged in addition to the stake.</p>}
          </>}
        </div>
      )}

      {rooms.some((room) => isLiveArenaRoom(room)) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h4 className="flex items-center gap-2 font-display text-sm font-semibold text-ink"><Radio size={15} className="animate-pulse text-coral" /> Live Now</h4>
            <span className="text-[10px] font-semibold uppercase text-stone">Witness without joining the match</span>
          </div>
          {rooms.filter((room) => isLiveArenaRoom(room)).map((room) => {
            const participants = room.arena_participants || [];
            const witnesses = (room.arena_viewers || []) as ArenaViewer[];
            const isParticipant = participants.some((participant: any) => participant.user_id === profile?.id && !participant.forfeited_at);
            return (
              <div data-artwork-theme={arenaImage?.url ? 'night' : undefined} key={room.id} className="card relative overflow-hidden p-4">
                <PanelImageBackdrop image={arenaImage} opacityFallback={20} veilClassName="arena-panel-veil" />
                <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-coral/35 bg-coral-soft text-coral"><Swords size={20} /></span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{cleanArenaRoomName(room.room_name)}</p>
                      <ArenaMatchup players={arenaMatchupPlayers(room)} playing />
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-stone">
                        <span>{parseArenaGameType(room.room_name) === 'ludo' ? 'Ludo Trivia' : parseArenaGameType(room.room_name) === 'journey' ? 'Standard Trivia: Biblical Journey' : 'Classic Trivia'}</span>
                        <span aria-hidden="true">·</span>
                        <ArenaElapsedTimer startedAt={room.started_at} />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <ArenaWitnessStrip witnesses={witnesses} guestCount={Number(room.arena_guest_witness_count) || 0} compact />
                    <button type="button" className="btn-ghost h-9 w-9 p-0" title="Share Arena match" aria-label="Share Arena match" onClick={() => void shareRoom(room.id)}><Share2 size={15} /></button>
                    <button
                      type="button"
                      onClick={() => !witnessOnly && isParticipant ? activateRoom(room.id, 'playing') : void watchRoom(room.id)}
                      className="btn-primary min-w-[6.5rem] text-xs"
                    >
                      {!witnessOnly && isParticipant ? <Play size={14} /> : <Eye size={14} />}
                      {!witnessOnly && isParticipant ? 'Enter Game' : 'Witness'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {witnessOnly && !rooms.some((room) => isLiveArenaRoom(room)) && (
        <EmptyState icon={(props) => <Eye {...props} />} title="No live matches" message="Active Arena games will appear here the moment they begin." />
      )}

      {instructorSchedule && rooms.some((room) => room.scheduled && room.status === 'waiting') && <section className="space-y-2">
        <h3 className="font-display text-sm font-semibold text-ink">Scheduled matches</h3>
        {rooms.filter((room) => room.scheduled && room.status === 'waiting').map((room) => <div key={room.id} className="flex flex-wrap items-center gap-3 border-b border-border py-3">
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{cleanArenaRoomName(room.room_name)}</p><p className="text-xs text-stone">{new Date(room.scheduled_start_at).toLocaleString()} · {(room.scheduled_player_ids || []).length} selected players</p></div>
          <button type="button" className="btn-ghost h-9 w-9 p-0" title="Share Arena room" aria-label="Share Arena room" onClick={() => void shareRoom(room.id)}><Share2 size={15} /></button>
          <button type="button" className="btn-secondary text-xs" onClick={() => void watchRoom(room.id, 'waiting')}><Eye size={14} /> Witness</button>
          <button type="button" className="btn-ghost text-xs text-coral" onClick={() => void cancelScheduledRoom(room.id)}>Cancel</button>
        </div>)}
      </section>}

      {!witnessOnly && <>
      <div className="space-y-2">
        <h4 className="font-display font-semibold text-ink text-sm">Open Rooms</h4>
        {rooms.filter((r) => r.status === 'waiting').length === 0 ? (
          <EmptyState icon={(props) => <Swords {...props} />} title="No open rooms" message="Create a room and invite other players to battle." />
        ) : (
          rooms.filter((r) => r.status === 'waiting').map((room) => {
            const participants = room.arena_participants || [];
            const witnesses = (room.arena_viewers || []) as ArenaViewer[];
            const isParticipant = participants.some((p: any) => p.user_id === profile?.id);
            const invited = Array.isArray(room.tagged_user_ids) && profile?.id ? room.tagged_user_ids.includes(profile.id) : false;
            const directChallengeUserId = room.direct_challenge_user_id as string | null | undefined;
            const isDirectChallenge = Boolean(directChallengeUserId);
            const isChallengeTarget = directChallengeUserId === profile?.id;
            const directChallengeStatus = room.direct_challenge_status as string | null | undefined;
            const challengeSourceRoomId = room.direct_challenge_source_room_id as string | null | undefined;
            return (
              <div data-artwork-theme={(arenaImage)?.url ? 'night' : undefined} key={room.id} className="card relative overflow-hidden p-4">
                <PanelImageBackdrop image={arenaImage} opacityFallback={18} veilClassName="arena-panel-veil" />
                <div className="relative z-10 min-w-0 space-y-3">
                  <p className="truncate text-center text-sm font-semibold text-ink">{cleanArenaRoomName(room.room_name)}</p>
                  <ArenaMatchup players={arenaMatchupPlayers(room)} />
                  <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
                    <button type="button" className="btn-ghost h-9 w-9 shrink-0 p-0" title="Share Arena room" aria-label="Share Arena room" onClick={() => void shareRoom(room.id)}><Share2 size={15} /></button>
                    {isParticipant ? (
                      <button onClick={() => activateRoom(room.id, 'waiting')} className="btn-secondary text-xs">
                        Enter Room
                      </button>
                    ) : isChallengeTarget && directChallengeStatus === 'scheduled' ? (
                      <button onClick={() => void startScheduledChallenge(room.id)} className="btn-primary text-xs">
                        <Play size={14} /> Start Scheduled
                      </button>
                    ) : isChallengeTarget && directChallengeStatus === 'pending' ? (
                      <button
                        onClick={() => {
                          if (challengeSourceRoomId) activateRoom(challengeSourceRoomId, 'playing');
                          else setError('Open your current Arena match to answer this challenge.');
                        }}
                        className="btn-primary text-xs"
                      >
                        <Swords size={14} /> Decide in Match
                      </button>
                    ) : isDirectChallenge && !isChallengeTarget ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <ArenaWitnessStrip witnesses={witnesses} guestCount={Number(room.arena_guest_witness_count) || 0} compact />
                        <button onClick={() => void watchRoom(room.id, 'waiting')} className="btn-secondary text-xs">
                          <Eye size={14} /> Witness
                        </button>
                      </div>
                    ) : room.scheduled ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => void watchRoom(room.id, 'waiting')} className="btn-secondary text-xs"><Eye size={14} /> Witness</button>
                        {room.scheduled_player_ids?.includes(profile?.id) && participants.length < room.max_players && (
                          <button onClick={() => void joinRoom(room.id)} className="btn-primary text-xs"><Play size={14} /> Enter Match</button>
                        )}
                      </div>
                    ) : participants.length >= room.max_players ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <ArenaWitnessStrip witnesses={witnesses} guestCount={Number(room.arena_guest_witness_count) || 0} compact />
                        <button onClick={() => void watchRoom(room.id, 'waiting')} className="btn-secondary text-xs">
                          <Eye size={14} /> Witness
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => joinRoom(room.id)} disabled={denarii < room.stake_amount || participants.length >= room.max_players}
                        className="btn-primary text-xs disabled:opacity-40">
                        {room.scheduled ? 'Enter Match' : invited ? 'Join Invite' : `Join (${formatDenarii(room.stake_amount)} Ð)`}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {rooms.filter((r) => r.status === 'completed').length > 0 && (
        <div className="space-y-2">
          <h4 className="font-display font-semibold text-ink text-sm">Recent Games</h4>
          {rooms.filter((r) => r.status === 'completed').slice(0, 5).map((room) => (
            <ArenaRecentResult key={room.id} roomId={room.id} arenaImage={arenaImage} />
          ))}
        </div>
      )}
      </>}
    </div>
  );
}

function parseArenaGameType(roomName: string) {
  return /\[arena:journey\]/i.test(roomName) ? 'journey' : /\[arena:ludo\]/i.test(roomName) ? 'ludo' : 'standard';
}

function cleanArenaRoomName(roomName: string) {
  return roomName.replace(/\s*\[.*?\]/g, '').trim() || 'Arena Match';
}

function arenaMatchupPlayers(room: any): ArenaMatchupPlayer[] {
  if (Array.isArray(room?.arena_matchup_players) && room.arena_matchup_players.length > 0) {
    return room.arena_matchup_players as ArenaMatchupPlayer[];
  }
  return (room?.arena_participants || []).map((participant: any) => ({
    user_id: participant.user_id,
    display_name: participant.profiles?.display_name || 'Player',
    avatar_url: participant.profiles?.avatar_url || null,
    tent_house_id: null,
    correct_count: Number(participant.correct_count) || 0,
  }));
}

function isLiveArenaRoom(room: any) {
  if (room?.status !== 'playing' || !room.started_at || room.completed_at) return false;
  const cutoff = Date.now() - 3 * 60_000;
  return (room.arena_participants || []).some((participant: any) => {
    if (participant.forfeited_at || participant.finished_at) return false;
    const lastActive = Date.parse(participant.last_active_at || participant.joined_at || room.started_at);
    return Number.isFinite(lastActive) && lastActive >= cutoff;
  });
}

function isWitnessableArenaRoom(room: any) {
  if (!room || room.completed_at) return false;
  return room.status === 'waiting' || isLiveArenaRoom(room);
}

function formatArenaElapsedTime(startedAt?: string | null, now = Date.now()) {
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  const totalSeconds = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function ArenaElapsedTimer({ startedAt }: { startedAt?: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <span className="inline-flex items-center gap-1 tabular-nums" title="Time since this match started" aria-label={`Match underway for ${formatArenaElapsedTime(startedAt, now)}`}>
      <Clock size={12} aria-hidden="true" />
      {formatArenaElapsedTime(startedAt, now)}
    </span>
  );
}

const ARENA_MACHINE_USER_ID = '00000000-0000-0000-0000-000000000000';

function parseArenaDifficulty(roomName: string): 'easy' | 'medium' | 'hard' {
  const match = roomName.match(/\[difficulty:(easy|medium|hard)\]/i);
  return (match?.[1]?.toLowerCase() as 'easy' | 'medium' | 'hard') || 'medium';
}

function ArenaWitnessStrip({ witnesses, guestCount = 0, compact = false }: { witnesses: ArenaViewer[]; guestCount?: number; compact?: boolean }) {
  const visible = witnesses.slice(0, compact ? 4 : 8);
  const guestVisible = Math.min(guestCount, Math.max(0, (compact ? 4 : 8) - visible.length));
  const remaining = Math.max(0, witnesses.length + guestCount - visible.length - guestVisible);
  return (
    <div className={cn(
      'flex min-w-0 items-center',
      compact ? 'gap-2' : 'mx-auto w-full max-w-3xl justify-between gap-3 rounded-lg border border-border bg-surface/85 px-3 py-2.5',
    )} aria-label={`${witnesses.length + guestCount} witnessing this Arena match`}>
      <span className={cn('flex items-center gap-1.5 font-semibold text-stone', compact ? 'text-[10px]' : 'text-xs')}>
        <Eye size={compact ? 13 : 15} className="text-royal" /> {witnesses.length + guestCount} witnessing
      </span>
      {visible.length + guestVisible > 0 && (
        <span className="flex -space-x-2">
          {visible.map((witness) => (
            <span key={witness.user_id} className={cn('relative inline-flex flex-shrink-0 rounded-full border-2 border-surface bg-surface shadow-sm', compact ? 'h-7 w-7' : 'h-8 w-8')} title={witness.profiles?.display_name || 'Arena witness'}>
              <UserAvatar userId={witness.user_id} name={witness.profiles?.display_name} avatarUrl={witness.profiles?.avatar_url} className="h-full w-full" />
            </span>
          ))}
          {Array.from({ length: guestVisible }, (_, index) => <span key={`guest-${index}`} className={cn('relative inline-flex flex-shrink-0 rounded-full border-2 border-surface bg-surface shadow-sm', compact ? 'h-7 w-7' : 'h-8 w-8')} title="Guest witness"><UserAvatar name="Guest witness" className="h-full w-full" showAwardBadge={false} /></span>)}
          {remaining > 0 && <span className={cn('relative inline-flex flex-shrink-0 items-center justify-center rounded-full border-2 border-surface bg-royal font-bold text-white shadow-sm', compact ? 'h-7 w-7 text-[8px]' : 'h-8 w-8 text-[9px]')}>+{remaining}</span>}
        </span>
      )}
    </div>
  );
}

export function ArenaStandardSpectator({ room, userId, onExit, allowChallenges, onGameCallCreated, onGameCallAction, publicAccess = false, guestKey }: {
  room: any;
  userId: string;
  onExit: () => void;
  allowChallenges: boolean;
  onGameCallCreated: (gameCall: ArenaChatGameCall) => Promise<void> | void;
  onGameCallAction: (gameCall: ArenaChatGameCall) => Promise<void> | void;
  publicAccess?: boolean;
  guestKey?: string;
}) {
  const [feed, setFeed] = useState<ArenaTriviaFeedItem[]>([]);
  const [liveQuestion, setLiveQuestion] = useState<ArenaLiveTriviaState | null>(null);
  const [playbackNow, setPlaybackNow] = useState(() => Date.now());
  const [feedError, setFeedError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [dismissedQuestionKey, setDismissedQuestionKey] = useState<string | null>(null);
  const participants = useMemo(() => room.arena_participants || [], [room.arena_participants]);
  const machineMatch = room.play_mode === 'machine';

  const refreshFeed = useCallback(async () => {
    try {
      setFeed(await (publicAccess ? fetchPublicArenaTriviaFeed(room.id) : fetchArenaTriviaFeed(room.id)));
      setFeedError(null);
    } catch (error: any) {
      setFeedError(error?.message || 'The live score could not be refreshed.');
    }
  }, [publicAccess, room.id]);

  useEffect(() => {
    void refreshFeed();
    const channel = supabase
      .channel(`arena-spectator-feed-${room.id}-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'arena_trivia_responses', filter: `room_id=eq.${room.id}` },
        (payload) => {
          const response = payload.new as Omit<ArenaTriviaFeedItem, 'display_name' | 'avatar_url'>;
          const participant = participants.find((item: any) => item.user_id === response.user_id);
          const nextResponse: ArenaTriviaFeedItem = {
            ...response,
            display_name: participant?.profiles?.display_name || 'Arena player',
            avatar_url: participant?.profiles?.avatar_url || null,
          };
          setFeed((current) => [
            nextResponse,
            ...current.filter((item) => item.user_id !== nextResponse.user_id || item.question_index !== nextResponse.question_index),
          ].slice(0, 160));
          if (machineMatch) void refreshFeed();
        },
      )
      .subscribe();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshFeed();
    }, 20_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshFeed(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
  }, [machineMatch, participants, refreshFeed, room.id, userId]);

  const refreshLiveQuestion = useCallback(async () => {
    try {
      setLiveQuestion(await (publicAccess ? fetchPublicArenaLiveState(room.id) : fetchArenaLiveTriviaState(room.id)));
      setPlaybackError(null);
    } catch (error) {
      setPlaybackError(error instanceof Error ? error.message : 'The live question is reconnecting.');
    }
  }, [publicAccess, room.id]);

  useEffect(() => {
    void refreshLiveQuestion();
    const channel = supabase
      .channel(`arena-live-question-${room.id}-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'arena_live_trivia_states', filter: `room_id=eq.${room.id}` },
        () => { void refreshLiveQuestion(); },
      )
      .subscribe();
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshLiveQuestion();
    }, 5000);
    const clockInterval = window.setInterval(() => setPlaybackNow(Date.now()), 250);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshLiveQuestion();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(refreshInterval);
      window.clearInterval(clockInterval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      void supabase.removeChannel(channel);
    };
  }, [refreshLiveQuestion, room.id, userId]);

  const scores = feed.reduce((totals, response) => {
    totals.set(response.user_id, (totals.get(response.user_id) || 0) + response.figs_earned);
    return totals;
  }, new Map<string, number>());
  const orderedFeed = [...feed].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
  const latest = orderedFeed[0] || null;
  const currentQuestion = Math.max(0, ...feed.map((response) => response.question_index));
  const activeParticipant = participants.length > 0 ? participants[feed.length % participants.length] : null;
  const boardPlayers: ArenaBoardPlayer[] = participants.map((participant: any) => ({
    userId: participant.user_id,
    name: participant.profiles?.display_name || 'Arena player',
    avatarUrl: participant.profiles?.avatar_url || null,
    score: scores.get(participant.user_id) || 0,
    active: !machineMatch && participant.user_id === activeParticipant?.user_id,
  }));
  if (machineMatch) {
    boardPlayers.push({
      userId: ARENA_MACHINE_USER_ID,
      name: 'The Scribe',
      avatarUrl: null,
      score: scores.get(ARENA_MACHINE_USER_ID) || 0,
      active: false,
    });
  }
  const currentRound = getArenaRoundForIndex(currentQuestion);
  const activeWitnessQuestion = liveQuestion && (
    liveQuestion.phase === 'question'
    || (liveQuestion.answered_at != null && playbackNow - Date.parse(liveQuestion.answered_at) < 5000)
  ) ? liveQuestion : null;
  const activeQuestionKey = activeWitnessQuestion
    ? `${room.id}:${activeWitnessQuestion.question_index}:${activeWitnessQuestion.actor_kind}:${activeWitnessQuestion.player_id || ''}:${activeWitnessQuestion.opened_at}`
    : null;
  const showWitnessQuestion = Boolean(activeWitnessQuestion && activeQuestionKey !== dismissedQuestionKey && !chatOpen);

  return (
    <div className="mx-auto max-w-3xl space-y-3 animate-fade-in">
      <div className="flex items-center justify-between gap-3 px-1">
        <button type="button" onClick={onExit} className="btn-ghost text-sm"><ArrowLeft size={14} /> Arena</button>
        <span className="badge badge-gold"><Eye size={12} /> Witnessing Live</span>
        <span className="text-xs font-bold text-stone">Round {currentRound + 1} · {ARENA_ROUND_LABELS[currentRound]}</span>
      </div>
      <div className="flex gap-1.5 px-1">
        {ARENA_ROUND_LENGTHS.map((_, index) => <div key={index} className={cn('h-1.5 flex-1 rounded-full', index < currentRound ? 'bg-sage' : index === currentRound ? 'bg-gold' : 'bg-surface-2')} />)}
      </div>
      <div className="flex items-center justify-between gap-3 px-1 text-[11px] text-stone sm:text-xs">
        <span className="truncate font-semibold text-ink">{cleanArenaRoomName(room.room_name)}</span>
        <span className="truncate">{boardPlayers.map((player) => `${player.name} ${player.score}`).join(' · ')}</span>
      </div>
      {feedError && <div className="rounded-lg border border-coral/30 bg-coral-soft px-3 py-2 text-xs text-coral">{feedError}</div>}
      {playbackError && <div className="rounded-lg border border-gold/30 bg-gold-soft px-3 py-2 text-xs text-brass">{playbackError}</div>}
      <ArenaBattleBoard
        players={boardPlayers}
        currentQuestion={currentQuestion}
        isMyTurn={false}
        rolling={false}
        revealingRoll={false}
        dieValue={1}
        latestOutcome={latest ? { player: latest.display_name, correct: latest.is_correct, answer: latest.submitted_answer || 'No answer' } : null}
        waitingName={machineMatch ? 'The match is live' : activeParticipant?.profiles?.display_name}
        onRoll={() => undefined}
      />
      <ArenaWitnessChatDrawer
        roomId={room.id}
        userId={userId}
        guestKey={guestKey}
        open={chatOpen}
        showLauncher={!showWitnessQuestion}
        onOpenChange={setChatOpen}
        allowGameCalls={allowChallenges}
        challengeTargets={allowChallenges ? participants.map((participant: any) => ({
          userId: participant.user_id,
          name: participant.profiles?.display_name || 'Arena player',
          avatarUrl: participant.profiles?.avatar_url || null,
        })) : []}
        onGameCallCreated={allowChallenges ? onGameCallCreated : undefined}
        onGameCallAction={allowChallenges ? onGameCallAction : undefined}
      />
      {showWitnessQuestion && activeWitnessQuestion && (
        <ArenaWitnessQuestionOverlay
          state={activeWitnessQuestion}
          onClose={() => setDismissedQuestionKey(activeQuestionKey)}
          onOpenChat={() => setChatOpen(true)}
        />
      )}
    </div>
  );
}

function ArenaWitnessQuestionOverlay({ state, onClose, onOpenChat }: {
  state: ArenaLiveTriviaState;
  onClose: () => void;
  onOpenChat: () => void;
}) {
  const question = state.question || ({} as QuestionPayload);
  const selected = state.selected_answer || '';
  const verdictVisible = state.phase === 'verdict';
  const options = question.type === 'true_false' ? ['True', 'False'] : question.options || [];
  return (
    <div className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-black/65 px-4 py-6 backdrop-blur-sm" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg border border-gold/45 bg-bg p-5 shadow-2xl sm:p-6" role="dialog" aria-modal="true" aria-label="Live Arena question">
        <div className="sticky top-0 z-10 mb-4 flex items-center gap-3 bg-bg pb-2">
          <span className="relative flex h-10 w-10 flex-shrink-0">
            <UserAvatar userId={state.player_id || 'arena-machine'} name={state.actor_name} avatarUrl={state.actor_avatar_url} className="h-full w-full border-2 border-gold" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink">{state.actor_name}</p>
            <p className="eyebrow mt-0.5">Question {state.question_index + 1} · Witness view</p>
          </div>
          <div className="ml-auto flex flex-shrink-0 items-center gap-1">
            <button type="button" onClick={onOpenChat} className="icon-btn h-8 w-8" title="Open match chat" aria-label="Open match chat"><MessageCircle size={16} /></button>
            <button type="button" onClick={onClose} className="icon-btn h-8 w-8" title="Close question" aria-label="Close question"><X size={17} /></button>
          </div>
        </div>
        <h3 className="mb-5 font-display text-lg font-semibold leading-snug text-ink sm:text-xl">{question.question || 'The next question is opening...'}</h3>
        {verdictVisible && (
          <div className={cn('mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-bold', state.is_correct ? 'border-sage/40 bg-sage-soft text-sage' : 'border-coral/40 bg-coral-soft text-coral')}>
            {state.is_correct ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            {state.is_correct ? 'Right answer' : 'Wrong answer'}
          </div>
        )}
        {options.length > 0 ? (
          <div className={cn('grid gap-2', question.type === 'true_false' && 'grid-cols-2')}>
            {options.map((option) => {
              const wasSelected = verdictVisible && option.trim().toLowerCase() === selected.trim().toLowerCase();
              return (
                <div key={option} className={cn(
                  'rounded-lg border p-3.5 text-sm font-semibold text-ink',
                  wasSelected && state.is_correct && 'border-sage bg-sage-soft text-sage',
                  wasSelected && !state.is_correct && 'border-coral bg-coral-soft text-coral',
                  !wasSelected && 'border-border bg-surface-2',
                )}>
                  {option}{wasSelected && <span className="ml-2 text-[10px] uppercase">Selected</span>}
                </div>
              );
            })}
          </div>
        ) : verdictVisible ? (
          <div className={cn('rounded-lg border px-4 py-3 text-sm font-semibold', state.is_correct ? 'border-sage bg-sage-soft text-sage' : 'border-coral bg-coral-soft text-coral')}>
            {selected || 'No answer'} <span className="ml-2 text-[10px] uppercase">Selected</span>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-stone">The player is typing an answer.</div>
        )}
      </div>
    </div>
  );
}

const ARENA_ROUND_LENGTHS = [6, 6, 7];
const ARENA_ROUND_LABELS = ['Easy', 'Medium', 'Hard'];

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
  revealingRoll,
  dieValue,
  latestOutcome,
  waitingName,
  onRoll,
}: {
  players: ArenaBoardPlayer[];
  currentQuestion: number;
  isMyTurn: boolean;
  rolling: boolean;
  revealingRoll: boolean;
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
                      <UserAvatar userId={player.userId} name={player.name} avatarUrl={player.avatarUrl} className="h-full w-full" />

                    </span>
                  ))}
                </span>
              )}
            </div>
          );
        })}

        <div className="col-start-2 col-end-6 row-start-2 row-end-6 flex min-h-0 flex-col items-center justify-center rounded-lg border border-white/10 bg-navy/72 p-3 text-center shadow-inner backdrop-blur-sm">
          {isMyTurn ? (
            <ArenaDieButton value={dieValue} rolling={rolling} revealing={revealingRoll} onRoll={onRoll} />
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

function ArenaGamePlay({ roomName, roomId, userId, roomQuestionSet, onComplete, onForfeit, forfeiting, onExit, onGameCallAction }: {
  roomName: string;
  roomId: string;
  userId: string;
  roomQuestionSet?: QuestionPayload[] | null;
  onComplete: (score: number, correctCount: number) => Promise<void>;
  onForfeit: () => void;
  forfeiting: boolean;
  onExit: () => void;
  onGameCallAction: (gameCall: ArenaChatGameCall) => Promise<void> | void;
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
  const [revealingRoll, setRevealingRoll] = useState(false);
  const [dieValue, setDieValue] = useState(1);
  const [questionRetry, setQuestionRetry] = useState(0);
  const [settling, setSettling] = useState(false);
  const [settlementError, setSettlementError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rollRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    const channel = supabase
      .channel(`arena-player-feed-${roomId}-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'arena_trivia_responses', filter: `room_id=eq.${roomId}` },
        () => { void refreshAnswerFeed(); })
      .subscribe();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshAnswerFeed();
    }, 8000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshAnswerFeed(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
  }, [refreshAnswerFeed, roomId, userId]);

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
    setSettlementError(null);
    setSettling(true);
    void onComplete(finalScore, finalCorrectCount).catch((error) => {
      setSettling(false);
      setSettlementError(error instanceof Error ? error.message : 'The Arena result could not be saved.');
    });
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
      setRevealingRoll(false);
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
    try {
      await publishArenaTriviaState(roomId, machineQuestionIndex, 'question', 'machine');
    } catch (error) {
      console.error('Arena machine question could not reach witnesses.', error);
      setAnswerError('The live witness view is reconnecting. The match will continue.');
    }
    const delay = machineDifficulty === 'easy' ? 2600 : machineDifficulty === 'hard' ? 1250 : 1850;
    await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
    const machineCorrect = Boolean(result.machineCorrect);
    const selected = result.machineAnswer || 'No answer';
    const nextMachineScore = result.machineTotalFigs;
    setMachineScore(nextMachineScore);
    setLatestOutcome({ player: 'The Scribe', correct: machineCorrect, answer: selected });
    setTurnPhase('machine-feedback');
    try {
      await publishArenaTriviaState(roomId, machineQuestionIndex, 'verdict', 'machine');
    } catch (error) {
      console.error('Arena machine verdict could not reach witnesses.', error);
      setAnswerError('The live witness verdict is reconnecting.');
    }
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
    if (!isMyTurn || turnPhase !== 'user' || rolling || revealingRoll || questionOpen || answeredIds.has(currentQ)) return;
    if (rollRevealTimerRef.current) window.clearTimeout(rollRevealTimerRef.current);
    setRolling(true);
    setRevealingRoll(false);
    setAnswerError(null);
    let ticks = 0;
    const animation = window.setInterval(() => {
      setDieValue(Math.floor(Math.random() * 6) + 1);
      ticks += 1;
      if (ticks < 8) return;
      window.clearInterval(animation);
      setRolling(false);
      setRevealingRoll(true);
      rollRevealTimerRef.current = window.setTimeout(() => {
        void (async () => {
          setRevealingRoll(false);
          try {
            await publishArenaTriviaState(roomId, currentQ, 'question', 'player');
            setQuestionOpen(true);
            void playSoundEffect('sound_arena_round', 0.62);
          } catch (error) {
            console.error('Arena question could not reach witnesses.', error);
            setAnswerError('The shared question could not open. Roll again to reconnect it.');
          }
        })();
      }, 950);
    }, 70);
  }, [answeredIds, currentQ, isMyTurn, questionOpen, revealingRoll, rolling, roomId, turnPhase]);

  useEffect(() => () => {
    if (rollRevealTimerRef.current) window.clearTimeout(rollRevealTimerRef.current);
  }, []);

  if (!ready) return <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-brass" /></div>;

  if (settling || settlementError) return <div className="flex min-h-60 flex-col items-center justify-center gap-3 text-center">
    {settlementError ? <><p className="text-sm text-coral">{settlementError}</p><button type="button" className="btn-secondary text-xs" onClick={() => {
      completedRef.current = false;
      completeGame();
    }}><RotateCw size={14} /> Try again</button></>
      : <><Loader2 size={20} className="animate-spin text-brass" /><p className="text-sm text-stone">Waiting for the match result...</p></>}
  </div>;

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
        <span className="text-xs font-bold text-stone">Round {currentRound + 1} · {ARENA_ROUND_LABELS[currentRound]}</span>
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
        revealingRoll={revealingRoll}
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
          <ArenaRoomChat roomId={roomId} userId={userId} compact onGameCallAction={onGameCallAction} />
        </details>
      )}

      {questionOpen && isMyTurn && (turnPhase === 'user' || turnPhase === 'user-feedback') && (
        <div className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-black/65 px-4 py-6 backdrop-blur-sm">
          <div className="relative z-[2147483001] max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg border border-gold/45 bg-bg p-5 shadow-2xl sm:p-6" role="dialog" aria-modal="true" aria-label="Arena question">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="relative flex h-10 w-10 flex-shrink-0"><UserAvatar userId={profile?.id} name={profile?.display_name} avatarUrl={profile?.avatar_url} className="h-full w-full border-2 border-gold" /></span>
                <div className="min-w-0"><p className="text-xs font-bold text-ink">{profile?.display_name || 'Your question'}</p><p className="eyebrow mt-0.5">{q.is_bonus ? `${ARENA_ROUND_LABELS[currentRound]} Bonus · 2 figs` : `${ARENA_ROUND_LABELS[currentRound]} · Question ${roundQuestionNumber}`}</p></div>
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
