import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, Dices, Eye, Loader2, MessageCircle, Play, Plus, Send, Swords, Users, X } from 'lucide-react';
import { AppSelect } from './AppSelect';
import { UserAvatar } from './UserAvatar';
import {
  createArenaChatGameCall,
  fetchArenaChatGameCalls,
  fetchArenaRoomMessages,
  sendArenaRoomMessage,
} from '../lib/queries';
import type { ArenaChatGameCall } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { cn, formatDenarii } from '../lib/utils';

type ArenaMessage = {
  id: string;
  room_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender: { id: string; display_name: string; avatar_url: string | null } | null;
};

export type ArenaChallengeTarget = {
  userId: string;
  name: string;
  avatarUrl: string | null;
};

type Props = {
  roomId: string;
  userId: string;
  compact?: boolean;
  allowGameCalls?: boolean;
  challengeTargets?: ArenaChallengeTarget[];
  onGameCallCreated?: (gameCall: ArenaChatGameCall) => Promise<void> | void;
  onGameCallAction?: (gameCall: ArenaChatGameCall) => Promise<void> | void;
};

function chatErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return fallback;
}

function gameCallAction(gameCall: ArenaChatGameCall, userId: string, allowOpenCallActions: boolean) {
  if (gameCall.participant_ids.includes(userId)) return { label: 'Enter', icon: Play };
  if (gameCall.challenged_user_id) {
    if (gameCall.challenged_user_id === userId) return null;
    if (allowOpenCallActions && (gameCall.room_status === 'waiting' || gameCall.room_status === 'playing')) {
      return { label: 'Witness', icon: Eye };
    }
    return null;
  }
  if (!allowOpenCallActions) return null;
  if (gameCall.room_status === 'waiting' && gameCall.participant_count < gameCall.max_players) {
    return { label: 'Join', icon: Plus };
  }
  if (gameCall.room_status === 'waiting' || gameCall.room_status === 'playing') {
    return { label: 'Witness', icon: Eye };
  }
  return null;
}

function ArenaGameCallCard({
  gameCall,
  userId,
  busy,
  allowOpenCallActions,
  onAction,
}: {
  gameCall: ArenaChatGameCall;
  userId: string;
  busy: boolean;
  allowOpenCallActions: boolean;
  onAction?: (gameCall: ArenaChatGameCall) => Promise<void> | void;
}) {
  const action = gameCallAction(gameCall, userId, allowOpenCallActions);
  const ActionIcon = action?.icon;
  const closed = !['waiting', 'playing'].includes(gameCall.room_status);
  const statusLabel = gameCall.challenged_user_id
    ? gameCall.challenge_status === 'scheduled'
      ? 'Scheduled next'
      : gameCall.challenge_status === 'declined'
        ? 'Declined'
        : gameCall.challenge_status === 'pending' && gameCall.challenged_user_id === userId
          ? 'Decision required'
          : closed
            ? 'Closed'
            : null
    : closed
      ? 'Closed'
      : null;
  const challengeLabel = gameCall.challenged_user_id
    ? gameCall.creator_id === userId
      ? `You challenged ${gameCall.challenged_user_name || 'a player'}`
      : gameCall.challenged_user_id === userId
        ? `${gameCall.creator_name} challenged you`
        : `${gameCall.creator_name} challenged ${gameCall.challenged_user_name || 'a player'}`
    : gameCall.creator_id === userId
      ? 'Your game call'
      : `${gameCall.creator_name} called a game`;

  return (
    <div className="rounded-lg border border-gold/35 bg-gold-soft/75 p-3 shadow-sm">
      <div className="flex items-start gap-2.5">
        <UserAvatar
          userId={gameCall.creator_id}
          name={gameCall.creator_name}
          avatarUrl={gameCall.creator_avatar_url}
          className="h-8 w-8 flex-shrink-0 border border-gold/40"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-ink">{challengeLabel}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold text-stone">
            <span className="flex items-center gap-1">
              {gameCall.game_type === 'ludo' ? <Dices size={11} /> : <Swords size={11} />}
              {gameCall.game_type === 'ludo' ? 'Ludo Trivia' : 'Standard Trivia'}
            </span>
            <span className="flex items-center gap-1"><Coins size={11} /> {formatDenarii(gameCall.stake_amount)} Ð</span>
            <span className="flex items-center gap-1"><Users size={11} /> {gameCall.participant_count}/{gameCall.max_players}</span>
          </p>
        </div>
        {action && onAction ? (
          <button
            type="button"
            onClick={() => void onAction(gameCall)}
            disabled={busy}
            className={cn(action.label === 'Witness' ? 'btn-secondary' : 'btn-primary', 'min-w-[4.75rem] px-2.5 py-2 text-[11px]')}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : ActionIcon && <ActionIcon size={13} />}
            {action.label}
          </button>
        ) : statusLabel ? (
          <span className="badge max-w-[6.5rem] text-center text-[9px] text-stone">{statusLabel}</span>
        ) : null}
      </div>
    </div>
  );
}

export function ArenaRoomChat({
  roomId,
  userId,
  compact = false,
  allowGameCalls = false,
  challengeTargets = [],
  onGameCallCreated,
  onGameCallAction,
}: Props) {
  const [messages, setMessages] = useState<ArenaMessage[]>([]);
  const [gameCalls, setGameCalls] = useState<ArenaChatGameCall[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [showCallForm, setShowCallForm] = useState(false);
  const [gameType, setGameType] = useState<'standard' | 'ludo'>('standard');
  const [stake, setStake] = useState(50);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [creatingCall, setCreatingCall] = useState(false);
  const [busyCallId, setBusyCallId] = useState<string | null>(null);
  const [challengeTarget, setChallengeTarget] = useState<ArenaChallengeTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const useGameCalls = allowGameCalls || Boolean(onGameCallAction);

  const loadMessages = useCallback(async () => {
    try {
      setMessages(await fetchArenaRoomMessages(roomId) as ArenaMessage[]);
    } catch (loadError) {
      console.error('Arena chat load failed', loadError);
    }
  }, [roomId]);

  const loadCalls = useCallback(async () => {
    if (!useGameCalls) return;
    try {
      setGameCalls(await fetchArenaChatGameCalls(roomId));
    } catch (loadError) {
      console.error('Arena game calls load failed', loadError);
    }
  }, [roomId, useGameCalls]);

  useEffect(() => {
    void Promise.all([loadMessages(), useGameCalls ? loadCalls() : Promise.resolve()]);
    let refreshTimer: number | null = null;
    const refreshCallsSoon = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => { void loadCalls(); }, 160);
    };
    const channel = supabase.channel(`arena-room-chat-${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'arena_room_messages', filter: `room_id=eq.${roomId}` }, () => void loadMessages());
    if (useGameCalls) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'arena_chat_game_calls', filter: `source_room_id=eq.${roomId}` }, refreshCallsSoon);
    }
    channel.subscribe();
    const interval = window.setInterval(() => {
      if (useGameCalls && document.visibilityState === 'visible') void loadCalls();
    }, 20_000);
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [loadCalls, loadMessages, roomId, useGameCalls]);

  const timeline = useMemo(() => [
    ...messages.map((message) => ({ kind: 'message' as const, id: message.id, createdAt: message.created_at, message })),
    ...gameCalls.map((gameCall) => ({ kind: 'call' as const, id: gameCall.id, createdAt: gameCall.created_at, gameCall })),
  ].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()), [gameCalls, messages]);

  const send = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendArenaRoomMessage(roomId, userId, body);
      setBody('');
      await loadMessages();
    } catch (sendError: unknown) {
      setError(chatErrorMessage(sendError, 'That message could not be sent.'));
    } finally {
      setSending(false);
    }
  };

  const createCall = async () => {
    if (creatingCall) return;
    setCreatingCall(true);
    setError(null);
    try {
      const targetRoomId = await createArenaChatGameCall({
        sourceRoomId: roomId,
        gameType,
        stakeAmount: Math.max(10, Math.round(stake || 0)),
        maxPlayers: challengeTarget ? 2 : Math.max(2, Math.round(maxPlayers || 0)),
        challengedUserId: challengeTarget?.userId || null,
      });
      const nextCalls = await fetchArenaChatGameCalls(roomId);
      setGameCalls(nextCalls);
      const created = nextCalls.find((gameCall) => gameCall.target_room_id === targetRoomId);
      if (!created) throw new Error('The game was called, but its room could not be opened yet.');
      setShowCallForm(false);
      setChallengeTarget(null);
      await onGameCallCreated?.(created);
    } catch (callError: unknown) {
      setError(chatErrorMessage(callError, 'That Arena game could not be called.'));
    } finally {
      setCreatingCall(false);
    }
  };

  const actOnCall = async (gameCall: ArenaChatGameCall) => {
    if (!onGameCallAction || busyCallId) return;
    setBusyCallId(gameCall.id);
    setError(null);
    try {
      await onGameCallAction(gameCall);
    } catch (actionError: unknown) {
      setError(chatErrorMessage(actionError, 'That Arena room could not be opened.'));
      await loadCalls();
    } finally {
      setBusyCallId(null);
    }
  };

  return (
    <div className={cn(compact ? 'p-3 pt-1' : 'mb-4 rounded-lg border border-border bg-surface/88 p-3')}>
      <div className="mb-2 flex items-center justify-between gap-2">
        {!compact && <div className="flex items-center gap-2 text-xs font-semibold text-ink"><MessageCircle size={14} className="text-brass" /> Room chat</div>}
        {allowGameCalls && (
          <button
            type="button"
            onClick={() => {
              setChallengeTarget(null);
              setShowCallForm((open) => !open);
            }}
            className="btn-secondary ml-auto px-2.5 py-1.5 text-[10px]"
            aria-expanded={showCallForm}
          >
            {showCallForm ? <X size={13} /> : <Swords size={13} />}
            {showCallForm ? 'Close' : 'Call game'}
          </button>
        )}
      </div>

      {allowGameCalls && challengeTargets.length > 0 && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label="Challenge an Arena player">
          {challengeTargets.map((target) => (
            <button
              key={target.userId}
              type="button"
              onClick={() => {
                setChallengeTarget(target);
                setMaxPlayers(2);
                setShowCallForm(true);
              }}
              className="flex min-w-[7.5rem] flex-shrink-0 items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-left transition-colors hover:border-gold/60 hover:bg-gold-soft"
              aria-label={`Challenge ${target.name}`}
            >
              <UserAvatar userId={target.userId} name={target.name} avatarUrl={target.avatarUrl} className="h-7 w-7 flex-shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-bold text-ink">{target.name}</span>
                <span className="flex items-center gap-1 text-[9px] font-bold uppercase text-gold"><Swords size={10} /> Challenge</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {showCallForm && (
        <div className="mb-3 space-y-2 rounded-lg border border-brass/35 bg-surface-2/95 p-3 animate-slide-up">
          {challengeTarget && (
            <div className="flex items-center gap-2 rounded-md border border-gold/30 bg-gold-soft px-2.5 py-2">
              <UserAvatar userId={challengeTarget.userId} name={challengeTarget.name} avatarUrl={challengeTarget.avatarUrl} className="h-7 w-7 flex-shrink-0" />
              <p className="min-w-0 flex-1 truncate text-xs font-bold text-ink">Challenge {challengeTarget.name}</p>
              <button type="button" onClick={() => setChallengeTarget(null)} className="btn-ghost h-7 w-7 p-0" aria-label="Cancel direct challenge"><X size={13} /></button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase text-stone">Game</label>
              <AppSelect
                value={gameType}
                onChange={(value) => {
                  const nextType = value as 'standard' | 'ludo';
                  setGameType(nextType);
                  if (nextType === 'ludo') setMaxPlayers((current) => Math.min(current, 4));
                }}
                options={[{ value: 'standard', label: 'Standard Trivia' }, { value: 'ludo', label: 'Ludo Trivia' }]}
                buttonClassName="min-h-[2.4rem] text-xs"
              />
            </div>
            {!challengeTarget && <div>
              <label className="mb-1 block text-[10px] font-bold uppercase text-stone">Total players</label>
              <input
                type="number"
                min={2}
                max={gameType === 'ludo' ? 4 : 8}
                value={maxPlayers}
                onChange={(event) => setMaxPlayers(Math.max(2, Math.min(gameType === 'ludo' ? 4 : 8, Number(event.target.value) || 2)))}
                className="input-field min-h-[2.4rem] text-sm"
              />
            </div>}
          </div>
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 text-[10px] font-bold uppercase text-stone">
              Stake per player
              <input
                type="number"
                min={10}
                step={10}
                value={stake}
                onChange={(event) => setStake(Math.max(10, Number(event.target.value) || 10))}
                className="input-field mt-1 min-h-[2.4rem] text-sm"
              />
            </label>
            <button type="button" onClick={() => void createCall()} disabled={creatingCall} className="btn-primary min-h-[2.4rem] px-3 text-xs">
              {creatingCall ? <Loader2 size={14} className="animate-spin" /> : <Swords size={14} />}
              {challengeTarget ? 'Challenge' : 'Call'}
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-stone">Your stake and the 10 Ð call fee are charged when the room is created.</p>
        </div>
      )}

      {error && <div className="mb-2 rounded-md border border-coral/30 bg-coral-soft px-2.5 py-2 text-[11px] text-coral" role="alert">{error}</div>}

      <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
        {timeline.length === 0 ? <p className="py-3 text-center text-xs text-stone">Talk during the match.</p> : timeline.slice(-24).map((item) => {
          if (item.kind === 'call') {
            return <ArenaGameCallCard key={`call-${item.id}`} gameCall={item.gameCall} userId={userId} busy={busyCallId === item.id} allowOpenCallActions={allowGameCalls} onAction={onGameCallAction ? actOnCall : undefined} />;
          }
          const mine = item.message.sender_id === userId;
          return (
            <div key={`message-${item.id}`} className={cn('flex gap-2', mine ? 'justify-end' : 'justify-start')}>
              {!mine && <UserAvatar userId={item.message.sender_id} name={item.message.sender?.display_name} avatarUrl={item.message.sender?.avatar_url} className="mt-0.5 h-6 w-6 flex-shrink-0" />}
              <p className={cn('max-w-[84%] rounded-lg px-2.5 py-1.5 text-xs', mine ? 'bg-brass/15 text-ink' : 'bg-surface-2 text-ink')}>
                <span className="mr-1 font-bold">{mine ? 'You' : item.message.sender?.display_name || 'Player'}</span>{item.message.body}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void send(); } }}
          className="input-field min-w-0 flex-1 text-sm"
          placeholder="Write a message..."
          maxLength={500}
        />
        <button type="button" onClick={() => void send()} disabled={!body.trim() || sending} className="btn-primary px-3" aria-label="Send room message">
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
    </div>
  );
}
