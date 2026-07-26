import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { fetchTentMessages, sendTentMessage, markTentMessageRead } from '../lib/queries';
import type { Profile, TentMessage } from '../lib/types';
import { X, Send, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface TentMessengerProps {
  recipient: Profile;
  senderId: string;
  tentId: string;
  onClose: () => void;
}

export function TentMessenger({ recipient, senderId, tentId, onClose }: TentMessengerProps) {
  const [messages, setMessages] = useState<(TentMessage & { sender?: { display_name: string; avatar_url: string | null } })[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const msgs = await fetchTentMessages(tentId, senderId);
      const filtered = (msgs as any[]).filter(
        (m) => m.sender_id === senderId || m.recipient_id === senderId,
      ).filter(
        (m) => m.sender_id === recipient.id || m.recipient_id === recipient.id,
      );
      setMessages(filtered);
      for (const m of filtered) {
        if (m.recipient_id === senderId && !m.read_at) {
          await markTentMessageRead(m.id);
        }
      }
    } catch (e) { console.error('TentMessenger load error:', e); }
    setLoading(false);
  }, [tentId, senderId, recipient.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`tent_messages_${tentId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tent_messages', filter: `tent_id=eq.${tentId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tentId, load]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      await sendTentMessage(tentId, senderId, recipient.id, input.trim());
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
              <p className="text-xs text-stone">Tent member</p>
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

  const profile: Profile | undefined =
    'user_id' in member ? member.profiles : (member as Profile);
  const userId = 'user_id' in member ? member.user_id : (member as Profile).id;

  if (!profile) return null;

  const sizeClass = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-14 h-14 text-lg' : 'w-10 h-10 text-sm';
  const isMe = userId === currentUserId;

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
        <div className={cn(
          'rounded-full bg-surface-2 overflow-hidden flex items-center justify-center font-display font-bold text-brass flex-shrink-0 transition-all',
          sizeClass,
          !isMe && 'group-hover:ring-2 group-hover:ring-brass/50',
        )}>
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt={profile.display_name} className="w-full h-full object-cover" />
          ) : (
            profile.display_name.charAt(0)
          )}
        </div>
        {showName && <span className="text-sm text-ink font-medium">{profile.display_name}</span>}
      </button>
      {showMessenger && (
        <TentMessenger
          recipient={profile}
          senderId={currentUserId}
          tentId={tentId}
          onClose={() => setShowMessenger(false)}
        />
      )}
    </>
  );
}
