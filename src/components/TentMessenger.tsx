import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { fetchMessagePage, fetchConversationHiddenClaims, markMessagesRead, sendTentMessage, editTentMessage, sendDirectMessage, editDirectMessage, sendTentGroupMessage, editTentGroupMessage, fetchPanelImageSetting, markOpenMessageNotificationsRead } from '../lib/queries';
import type { PanelImageSetting, Profile } from '../lib/types';
import { AtSign, X, Send, Loader2, PhoneCall, Users, Pencil, Check, ChevronUp, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { useMessaging } from '../context/MessagingContext';
import { useSubscriptionAccess } from '../context/SubscriptionAccessContext';
import { revealHiddenChallenge } from '../lib/hiddenChallenges';
import { RelativeTime } from './RelativeTime';
import { PanelImageBackdrop } from './PanelImageBackdrop';
import { UserAvatar } from './UserAvatar';
import { setOpenMessageContext } from '../lib/messageOpenState';
import { requestAudioCall } from '../lib/audioCalls';
import { useMessageHistory } from '../hooks/useMessageHistory';
import type { ChatMessage, MessagePageOptions } from '../lib/messagePages';

function useChatScroll(messages: ChatMessage[], loadingOlder: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const stickToBottom = useRef(true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (anchor.current && !loadingOlder) {
      element.scrollTop = anchor.current.top + element.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (!anchor.current && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [messages, loadingOlder]);
  return {
    ref,
    onScroll: () => {
      const element = ref.current;
      if (element) stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
    },
    preserve: () => {
      const element = ref.current;
      if (element) anchor.current = { height: element.scrollHeight, top: element.scrollTop };
    },
  };
}

interface TentMessengerProps {
  recipient: Profile;
  senderId: string;
  tentId?: string;
  onClose: () => void;
  onMessagesRead?: () => void;
}

export function TentMessenger({ recipient, senderId, tentId, onClose, onMessagesRead }: TentMessengerProps) {
  const { hasAccess, requireSubscription } = useSubscriptionAccess();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [messageArtwork, setMessageArtwork] = useState<PanelImageSetting | null>(null);
  const revealedClaims = useRef(new Set<string>());
  const conversationKey = `${senderId}:${recipient.id}:${tentId || ''}`;
  const liveConversation = useRef(conversationKey);
  useEffect(() => {
    liveConversation.current = conversationKey;
    return () => { liveConversation.current = ''; };
  }, [conversationKey]);
  const onReadRef = useRef(onMessagesRead);
  onReadRef.current = onMessagesRead;
  const loadPage = useCallback(async (options: MessagePageOptions) => {
    const page = await fetchMessagePage({ userId: senderId, recipientId: recipient.id, tentId }, options);
    if (liveConversation.current !== conversationKey) return page;
    const unread = page.messages.filter(m => 'recipient_id' in m && m.recipient_id === senderId && !m.read_at);
    if (unread.length) {
      void markMessagesRead(tentId ? 'tent_messages' : 'direct_messages', senderId, unread.map(m => m.id))
        .then(() => onReadRef.current?.()).catch(() => undefined);
    }
    const claimIds = page.messages.flatMap(m => (
      'recipient_id' in m && m.recipient_id === senderId && 'hidden_challenge_claim_id' in m
      && m.hidden_challenge_claim_id && !revealedClaims.current.has(m.hidden_challenge_claim_id)
        ? [m.hidden_challenge_claim_id] : []
    ));
    if (claimIds.length) {
      claimIds.forEach(id => revealedClaims.current.add(id));
      revealHiddenChallenge({ claimIds });
    }
    return page;
  }, [senderId, recipient.id, tentId, conversationKey]);
  const { messages, loading, loadingOlder, hasOlder, error, refresh: load, loadOlder, update } = useMessageHistory(loadPage, hasAccess);
  const scroll = useChatScroll(messages, loadingOlder);

  useEffect(() => {
    if (!hasAccess || tentId) return;
    let active = true;
    // Opening a conversation must still reveal a treasure attached to an older message.
    void fetchConversationHiddenClaims(senderId, recipient.id).then(claimIds => {
      if (!active) return;
      const unseen = claimIds.filter(id => !revealedClaims.current.has(id));
      unseen.forEach(id => revealedClaims.current.add(id));
      if (unseen.length) revealHiddenChallenge({ claimIds: unseen });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [hasAccess, senderId, recipient.id, tentId]);

  useEffect(() => {
    if (hasAccess) return;
    requireSubscription();
    onClose();
  }, [hasAccess, onClose, requireSubscription]);

  useEffect(() => {
    let active = true;
    void fetchPanelImageSetting('messages').then((image) => {
      if (active) setMessageArtwork(image);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const context = tentId
      ? { kind: 'tent_direct' as const, senderId: recipient.id, tentId }
      : { kind: 'direct' as const, senderId: recipient.id };
    setOpenMessageContext(context);
    void markOpenMessageNotificationsRead({
      sourceTable: tentId ? 'tent_messages' : 'direct_messages',
      senderId: recipient.id,
      tentId,
    }).catch(() => undefined);
    return () => setOpenMessageContext(null);
  }, [recipient.id, tentId]);

  useEffect(() => {
    if (!hasAccess) return;
    const table = tentId ? 'tent_messages' : 'direct_messages';
    const channelName = `chat_${tentId || 'direct'}_${senderId}_${recipient.id}`;
    const changed = (payload: { eventType: string; new: Record<string, unknown> }) => {
      const message = payload.new;
      const isConversation = (message.sender_id === senderId && message.recipient_id === recipient.id)
        || (message.sender_id === recipient.id && message.recipient_id === senderId);
      if (!isConversation || (tentId && message.tent_id !== tentId)) return;
      if (payload.eventType === 'UPDATE') update(String(message.id), message as Partial<ChatMessage>);
      else if (document.visibilityState === 'visible') void load();
    };
    const channel = supabase.channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `sender_id=eq.${senderId}` }, changed)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `recipient_id=eq.${senderId}` }, changed)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [hasAccess, tentId, senderId, recipient.id, load, update]);

  const handleSend = async () => {
    if (!requireSubscription()) return;
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      if (tentId) await sendTentMessage(tentId, senderId, recipient.id, input.trim());
      else await sendDirectMessage(senderId, recipient.id, input.trim());
      setInput('');
      await load();
    } catch (e) { console.error('Send error:', e); }
    setSending(false);
  };

  const handleEdit = async () => {
    if (!requireSubscription()) return;
    if (!editingId || !editingBody.trim() || sending) return;
    setSending(true);
    try {
      if (tentId) await editTentMessage(editingId, editingBody.trim());
      else await editDirectMessage(editingId, editingBody.trim());
      update(editingId, { body: editingBody.trim(), edited_at: new Date().toISOString() });
      setEditingId(null);
      setEditingBody('');
      await load();
    } catch (e) { console.error('Edit message error:', e); }
    setSending(false);
  };

  if (!hasAccess) return null;

  const modal = (
    <div className="fixed inset-0 z-[2147483000] flex items-end sm:items-center justify-center bg-black/50 animate-fade-in" onClick={onClose}>
      <div data-artwork-theme={(messageArtwork)?.url ? 'night' : undefined}
        className="relative isolate z-[2147483001] flex max-h-[80vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-bg/[0.45] shadow-xl animate-slide-up sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <PanelImageBackdrop
          image={messageArtwork}
          opacityFallback={58}
          opacityOverride={Math.max(58, messageArtwork?.adjustments?.opacity ?? 0)}
          veilClassName="message-space-veil"
          textGradient={false}
        />
        {/* Header */}
        <div className="relative z-10 flex items-center justify-between border-b border-border bg-surface/[0.42] p-4 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <span className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center font-display text-sm font-bold text-brass">
              <UserAvatar userId={recipient.id} name={recipient.display_name} avatarUrl={recipient.avatar_url} className="h-full w-full border border-border" />

            </span>
            <div>
              <p className="font-display font-semibold text-ink text-sm">{recipient.display_name}</p>
              <p className="text-xs text-stone">{tentId ? 'Tent member' : 'Direct message'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors">
            <X size={18} className="text-stone" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scroll.ref} onScroll={scroll.onScroll} className="relative z-10 min-h-[200px] flex-1 space-y-2 overflow-y-auto p-4">
          {hasOlder && <button type="button" disabled={loadingOlder} className="btn-ghost mx-auto flex text-xs" onClick={() => { scroll.preserve(); void loadOlder(); }}><ChevronUp size={14} />{loadingOlder ? 'Loading...' : 'Earlier messages'}</button>}
          {error && <button type="button" className="flex items-center gap-2 text-xs text-coral" onClick={() => void load()}><RefreshCw size={14} />{error}</button>}
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-brass" /></div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-stone text-center py-8">No messages yet. Say hello!</p>
          ) : (
            messages.map((m) => {
              const isMe = m.sender_id === senderId;
              return (
                <div key={m.id} className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[75%] px-3 py-2 rounded-lg text-sm',
                    isMe ? 'bg-brass/15 text-ink border border-brass/30' : 'bg-surface-2 text-ink border border-border',
                  )}>
                    {editingId === m.id ? (
                      <div className="flex items-end gap-2">
                        <textarea value={editingBody} onChange={(event) => setEditingBody(event.target.value)} className="input-field min-h-16 flex-1 text-sm" autoFocus />
                        <button type="button" onClick={() => void handleEdit()} disabled={!editingBody.trim() || sending} className="icon-btn" aria-label="Save message"><Check size={15} /></button>
                      </div>
                    ) : <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                    {isMe && editingId !== m.id && <button type="button" className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-peri" onClick={() => { setEditingId(m.id); setEditingBody(m.body); }}><Pencil size={10} /> Edit</button>}
                    <p className="mt-1 text-[10px] text-stone"><RelativeTime value={m.created_at} /></p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Input */}
        <div className="relative z-10 flex items-center gap-2 border-t border-border bg-surface/[0.42] p-3 backdrop-blur-sm">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Type a message…"
            className="input-field flex-1 text-sm"
          />
          <button onClick={handleSend} disabled={!input.trim() || sending} className="btn-primary p-2.5">
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body);
}

export function TentGroupMessenger({
  tentId,
  senderId,
  tentName,
  onClose,
}: {
  tentId: string;
  senderId: string;
  tentName: string;
  onClose: () => void;
}) {
  const { hasAccess, requireSubscription } = useSubscriptionAccess();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [messageArtwork, setMessageArtwork] = useState<PanelImageSetting | null>(null);

  const loadPage = useCallback((options: MessagePageOptions) => fetchMessagePage({ userId: senderId, tentId }, options), [senderId, tentId]);
  const { messages, loading, loadingOlder, hasOlder, error, refresh: load, loadOlder, update } = useMessageHistory(loadPage, hasAccess);
  const scroll = useChatScroll(messages, loadingOlder);

  useEffect(() => {
    if (hasAccess) return;
    requireSubscription();
    onClose();
  }, [hasAccess, onClose, requireSubscription]);

  useEffect(() => {
    let active = true;
    void fetchPanelImageSetting('messages').then((image) => {
      if (active) setMessageArtwork(image);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setOpenMessageContext({ kind: 'tent_group', tentId });
    void markOpenMessageNotificationsRead({
      sourceTable: 'tent_group_messages',
      tentId,
    }).catch(() => undefined);
    return () => setOpenMessageContext(null);
  }, [tentId]);

  useEffect(() => {
    if (!hasAccess) return;
    const channel = supabase
      .channel(`tent_group_messages_${tentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tent_group_messages', filter: `tent_id=eq.${tentId}` }, payload => {
        if (payload.eventType === 'UPDATE') update(String(payload.new.id), payload.new as Partial<ChatMessage>);
        else if (document.visibilityState === 'visible') void load();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [hasAccess, load, tentId, update]);

  const handleSend = async () => {
    if (!requireSubscription()) return;
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      await sendTentGroupMessage(tentId, senderId, input.trim());
      setInput('');
      await load();
    } catch (e) {
      console.error('Group send error:', e);
    }
    setSending(false);
  };

  const handleEdit = async () => {
    if (!requireSubscription()) return;
    if (!editingId || !editingBody.trim() || sending) return;
    setSending(true);
    try {
      await editTentGroupMessage(editingId, editingBody.trim());
      update(editingId, { body: editingBody.trim(), edited_at: new Date().toISOString() });
      setEditingId(null);
      setEditingBody('');
      await load();
    } catch (e) { console.error('Edit group message error:', e); }
    setSending(false);
  };

  if (!hasAccess) return null;

  const modal = (
    <div className="fixed inset-0 z-[2147483000] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center" onClick={onClose}>
      <div data-artwork-theme={(messageArtwork)?.url ? 'night' : undefined}
        className="relative isolate z-[2147483001] flex max-h-[82vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-bg/[0.45] shadow-xl animate-slide-up sm:max-w-lg sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <PanelImageBackdrop
          image={messageArtwork}
          opacityFallback={58}
          opacityOverride={Math.max(58, messageArtwork?.adjustments?.opacity ?? 0)}
          veilClassName="message-space-veil"
          textGradient={false}
        />
        <div className="relative z-10 flex items-center justify-between border-b border-border bg-surface/[0.42] p-4 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-brass/25 bg-brass-soft text-brass">
              <Users size={18} />
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold text-ink">{tentName}</p>
              <p className="text-xs text-stone">Tent group chat</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => requestAudioCall('tent', tentId)} className="icon-btn text-sage" aria-label="Ring this tent" title="Ring this tent">
              <PhoneCall size={17} />
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 transition-colors hover:bg-surface-2" aria-label="Close tent chat">
              <X size={18} className="text-stone" />
            </button>
          </div>
        </div>

        <div ref={scroll.ref} onScroll={scroll.onScroll} className="relative z-10 min-h-[240px] flex-1 space-y-2 overflow-y-auto p-4">
          {hasOlder && <button type="button" disabled={loadingOlder} className="btn-ghost mx-auto flex text-xs" onClick={() => { scroll.preserve(); void loadOlder(); }}><ChevronUp size={14} />{loadingOlder ? 'Loading...' : 'Earlier messages'}</button>}
          {error && <button type="button" className="flex items-center gap-2 text-xs text-coral" onClick={() => void load()}><RefreshCw size={14} />{error}</button>}
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-brass" /></div>
          ) : messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-stone">No messages yet. Start the tent conversation.</p>
          ) : messages.map((message) => {
            const isMe = message.sender_id === senderId;
            return (
              <div key={message.id} className={cn('flex items-end gap-2', isMe ? 'justify-end' : 'justify-start')}>
                {!isMe && (
                  <span className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center text-[10px] font-bold text-brass">
                    <UserAvatar userId={message.sender_id} name={message.sender?.display_name || 'Tent member'} avatarUrl={message.sender?.avatar_url} className="h-full w-full border border-border" />

                  </span>
                )}
                <div className={cn(
                  'max-w-[78%] rounded-xl border px-3 py-2 text-sm',
                  isMe ? 'border-brass/30 bg-brass/15 text-ink' : 'border-border bg-surface-2 text-ink',
                )}>
                  {!isMe && <p className="mb-1 text-[10px] font-bold text-stone">{message.sender?.display_name || 'Tent member'}</p>}
                  {editingId === message.id ? (
                    <div className="flex items-end gap-2">
                      <textarea value={editingBody} onChange={(event) => setEditingBody(event.target.value)} className="input-field min-h-16 flex-1 text-sm" autoFocus />
                      <button type="button" onClick={() => void handleEdit()} disabled={!editingBody.trim() || sending} className="icon-btn" aria-label="Save message"><Check size={15} /></button>
                    </div>
                  ) : <p className="whitespace-pre-wrap break-words">{message.body}</p>}
                  {isMe && editingId !== message.id && <button type="button" className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-peri" onClick={() => { setEditingId(message.id); setEditingBody(message.body); }}><Pencil size={10} /> Edit</button>}
                  <p className="mt-1 text-[10px] text-stone"><RelativeTime value={message.created_at} /></p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="relative z-10 flex items-center gap-2 border-t border-border bg-surface/[0.42] p-3 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setInput((current) => /(^|\s)@all(?:\s|$)/i.test(current) ? current : `${current}${current && !/\s$/.test(current) ? ' ' : ''}@all `)}
            className="icon-btn flex-shrink-0"
            aria-label="Mention everyone in this tent"
            title="Mention everyone in this tent"
          >
            <AtSign size={16} />
          </button>
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSend(); } }}
            placeholder="Message the tent..."
            className="input-field flex-1 text-sm"
          />
          <button onClick={handleSend} disabled={!input.trim() || sending} className="btn-primary p-2.5" aria-label="Send tent message">
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body);
}

// Avatar with click-to-message popup
export function TentAvatar({
  member,
  currentUserId,
  tentId,
  size = 'md',
  showName = false,
  onOpenChange,
}: {
  member: { user_id: string; profiles?: Profile } | Profile;
  currentUserId: string;
  tentId: string;
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [showMessenger, setShowMessenger] = useState(false);
  const { unreadBySender, refreshDirectUnread } = useMessaging();
  const { requireSubscription } = useSubscriptionAccess();

  const profile: Profile | undefined =
    'user_id' in member ? member.profiles : (member as Profile);
  const userId = 'user_id' in member ? member.user_id : (member as Profile).id;

  if (!profile) return null;

  const sizeClass = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-14 h-14 text-lg' : 'w-10 h-10 text-sm';
  const isMe = userId === currentUserId;
  const unreadCount = !isMe ? unreadBySender[userId] || 0 : 0;

  return (
    <>
      <button
        onClick={() => {
          if (isMe) return;
          if (!requireSubscription()) return;
          setShowMessenger(true);
          onOpenChange?.(true);
          document.body.dataset.fullCircleMessengerOpen = 'true';
        }}
        className={cn(
          'inline-flex items-center gap-2 group',
          !isMe && 'cursor-pointer',
          isMe && 'cursor-default',
        )}
        title={isMe ? profile.display_name : `Message ${profile.display_name}`}
      >
        <span className="relative inline-flex shrink-0">
          <UserAvatar
            userId={userId}
            name={profile.display_name}
            avatarUrl={profile.avatar_url}
            awardBadgeSize={size === 'lg' ? 'md' : 'sm'}
            className={cn(
            'rounded-full border-2 border-border shadow-sm transition-all',
            sizeClass,
            !isMe && 'group-hover:ring-2 group-hover:ring-brass/50',
          )}
          />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 z-10 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full border border-bg bg-coral px-1 text-[9px] font-black leading-none text-white shadow-md">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </span>
        {showName && <span className="text-sm text-ink font-medium">{profile.display_name}</span>}
      </button>
      {showMessenger && (
        <TentMessenger
          recipient={profile}
          senderId={currentUserId}
          tentId={tentId}
          onClose={() => {
            setShowMessenger(false);
            onOpenChange?.(false);
            if (document.body.dataset.fullCircleMessengerOpen === 'true') delete document.body.dataset.fullCircleMessengerOpen;
          }}
          onMessagesRead={refreshDirectUnread}
        />
      )}
    </>
  );
}

export function MessageAvatar({
  profile,
  currentUserId,
  size = 'sm',
  showName = false,
  className,
  onOpenChange,
  showCurrentAward = true,
}: {
  profile: Profile;
  currentUserId?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showName?: boolean;
  className?: string;
  onOpenChange?: (open: boolean) => void;
  showCurrentAward?: boolean;
}) {
  const [showMessenger, setShowMessenger] = useState(false);
  const { unreadBySender, refreshDirectUnread } = useMessaging();
  const { requireSubscription } = useSubscriptionAccess();
  const sizeClass = size === 'xs' ? 'h-4 w-4 text-[7px]' : size === 'sm' ? 'w-9 h-9 text-xs' : size === 'lg' ? 'w-14 h-14 text-lg' : 'w-10 h-10 text-sm';
  const isMe = profile.id === currentUserId;
  const unreadCount = !isMe && currentUserId ? unreadBySender[profile.id] || 0 : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (isMe || !currentUserId) return;
          if (!requireSubscription()) return;
          setShowMessenger(true);
          onOpenChange?.(true);
          document.body.dataset.fullCircleMessengerOpen = 'true';
        }}
        className={cn('inline-flex items-center gap-2 group', className, !isMe && currentUserId ? 'cursor-pointer' : 'cursor-default')}
        title={isMe ? profile.display_name : `Message ${profile.display_name}`}
      >
        <span className="relative inline-flex shrink-0">
          <UserAvatar
            userId={profile.id}
            name={profile.display_name}
            avatarUrl={profile.avatar_url}
            showAwardBadge={showCurrentAward}
            awardBadgeSize={size === 'xs' ? 'xs' : size === 'lg' ? 'md' : 'sm'}
            className={cn('rounded-full border-2 border-border shadow-sm transition-all', sizeClass, !isMe && currentUserId && 'group-hover:ring-2 group-hover:ring-brass/50')}
          />
          {unreadCount > 0 && (
            <span className={cn(
              'absolute z-10 inline-flex items-center justify-center rounded-full border border-bg bg-coral font-black leading-none text-white shadow-md',
              size === 'xs' ? '-right-1 -top-1 min-h-3 min-w-3 px-0.5 text-[7px]' : '-right-1 -top-1 min-h-4 min-w-4 px-1 text-[9px]',
            )}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </span>
        {showName && <span className="text-sm text-ink font-medium">{profile.display_name}</span>}
      </button>
      {showMessenger && currentUserId && (
        <TentMessenger
          recipient={profile}
          senderId={currentUserId}
          onClose={() => {
            setShowMessenger(false);
            onOpenChange?.(false);
            if (document.body.dataset.fullCircleMessengerOpen === 'true') delete document.body.dataset.fullCircleMessengerOpen;
          }}
          onMessagesRead={refreshDirectUnread}
        />
      )}
    </>
  );
}
