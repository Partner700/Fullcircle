import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { fetchTentMessages, sendTentMessage, markTentMessageRead, fetchDirectMessages, sendDirectMessage, markDirectMessageRead } from '../lib/queries';
import type { DirectMessage, Profile, TentMessage } from '../lib/types';
import { X, Send, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useMessaging } from '../context/MessagingContext';

interface TentMessengerProps {
  recipient: Profile;
  senderId: string;
  tentId?: string;
  onClose: () => void;
  onMessagesRead?: () => void;
}

export function TentMessenger({ recipient, senderId, tentId, onClose, onMessagesRead }: TentMessengerProps) {
  const [messages, setMessages] = useState<((TentMessage | DirectMessage) & { sender?: { display_name: string; avatar_url: string | null } })[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const msgs = tentId
        ? await fetchTentMessages(tentId, senderId)
        : await fetchDirectMessages(senderId, recipient.id);
      const filtered = (msgs as any[]).filter(
        (m) => m.sender_id === senderId || m.recipient_id === senderId,
      ).filter(
        (m) => m.sender_id === recipient.id || m.recipient_id === recipient.id,
      );
      setMessages(filtered);
      for (const m of filtered) {
        if (m.recipient_id === senderId && !m.read_at) {
          if (tentId) await markTentMessageRead(m.id);
          else await markDirectMessageRead(m.id);
          onMessagesRead?.();
        }
      }
    } catch (e) { console.error('TentMessenger load error:', e); }
    setLoading(false);
  }, [tentId, senderId, recipient.id, onMessagesRead]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const table = tentId ? 'tent_messages' : 'direct_messages';
    const channelName = tentId ? `tent_messages_${tentId}` : `direct_messages_${senderId}_${recipient.id}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tentId, senderId, recipient.id, load]);

  const handleSend = async () => {
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

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 animate-fade-in" onClick={onClose}>
      <div
        className="w-full sm:max-w-md bg-bg rounded-t-2xl sm:rounded-2xl border border-border shadow-xl animate-slide-up flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-surface-2 overflow-hidden flex items-center justify-center font-display font-bold text-sm text-brass">
              {recipient.avatar_url ? (
                <img src={recipient.avatar_url} alt={recipient.display_name} className="w-full h-full object-cover" />
              ) : (
                recipient.display_name.charAt(0)
              )}
            </div>
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
        <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-[200px]">
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
                    <p>{m.body}</p>
                    <p className="text-[10px] text-stone mt-1">
                      {new Date(m.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Input */}
        <div className="p-3 border-t border-border flex items-center gap-2">
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
}

// Avatar with click-to-message popup
export function TentAvatar({
  member,
  currentUserId,
  tentId,
  size = 'md',
  showName = false,
}: {
  member: { user_id: string; profiles?: Profile } | Profile;
  currentUserId: string;
  tentId: string;
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
}) {
  const [showMessenger, setShowMessenger] = useState(false);
  const { unreadBySender, refreshDirectUnread } = useMessaging();

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
        onClick={() => !isMe && setShowMessenger(true)}
        className={cn(
          'inline-flex items-center gap-2 group',
          !isMe && 'cursor-pointer',
          isMe && 'cursor-default',
        )}
        title={isMe ? profile.display_name : `Message ${profile.display_name}`}
      >
        <span className="relative inline-flex shrink-0">
          <span className={cn(
            'rounded-full bg-surface-2 overflow-hidden flex items-center justify-center font-display font-bold text-brass transition-all',
            sizeClass,
            !isMe && 'group-hover:ring-2 group-hover:ring-brass/50',
          )}>
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt={profile.display_name} className="w-full h-full object-cover" />
            ) : (
              profile.display_name.charAt(0)
            )}
          </span>
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
          onClose={() => setShowMessenger(false)}
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
}: {
  profile: Profile;
  currentUserId?: string | null;
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
  className?: string;
}) {
  const [showMessenger, setShowMessenger] = useState(false);
  const { unreadBySender, refreshDirectUnread } = useMessaging();
  const sizeClass = size === 'sm' ? 'w-9 h-9 text-xs' : size === 'lg' ? 'w-14 h-14 text-lg' : 'w-10 h-10 text-sm';
  const isMe = profile.id === currentUserId;
  const unreadCount = !isMe && currentUserId ? unreadBySender[profile.id] || 0 : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => !isMe && currentUserId && setShowMessenger(true)}
        className={cn('inline-flex items-center gap-2 group', className, !isMe && currentUserId ? 'cursor-pointer' : 'cursor-default')}
        title={isMe ? profile.display_name : `Message ${profile.display_name}`}
      >
        <span className="relative inline-flex shrink-0">
          <span className={cn('rounded-full bg-surface-2 overflow-hidden flex items-center justify-center font-display font-bold text-brass transition-all', sizeClass, !isMe && currentUserId && 'group-hover:ring-2 group-hover:ring-brass/50')}>
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt={profile.display_name} className="w-full h-full object-cover" />
            ) : (
              profile.display_name.charAt(0)
            )}
          </span>
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 z-10 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full border border-bg bg-coral px-1 text-[9px] font-black leading-none text-white shadow-md">
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
          onClose={() => setShowMessenger(false)}
          onMessagesRead={refreshDirectUnread}
        />
      )}
    </>
  );
}
