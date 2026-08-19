import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { fetchUnreadDirectMessagesForUser } from '../lib/queries';
import { useAuth } from './AuthContext';

interface MessagingContextValue {
  unreadBySender: Record<string, number>;
  refreshDirectUnread: () => Promise<void>;
}

const MessagingContext = createContext<MessagingContextValue | undefined>(undefined);

export function MessagingProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [unreadBySender, setUnreadBySender] = useState<Record<string, number>>({});

  const refreshDirectUnread = useCallback(async () => {
    if (!profile?.id) {
      setUnreadBySender({});
      return;
    }
    const unread = await fetchUnreadDirectMessagesForUser(profile.id).catch(() => []);
    const next: Record<string, number> = {};
    unread.forEach((message: any) => {
      if (!message.sender_id || message.sender_id === profile.id) return;
      next[message.sender_id] = (next[message.sender_id] || 0) + 1;
    });
    setUnreadBySender(next);
  }, [profile?.id]);

  useEffect(() => {
    void refreshDirectUnread();
  }, [refreshDirectUnread]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`direct_unread_${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${profile.id}` },
        () => void refreshDirectUnread(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'direct_messages', filter: `sender_id=eq.${profile.id}` },
        () => void refreshDirectUnread(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, refreshDirectUnread]);

  const value = useMemo(() => ({ unreadBySender, refreshDirectUnread }), [unreadBySender, refreshDirectUnread]);

  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>;
}

export function useMessaging() {
  const ctx = useContext(MessagingContext);
  return ctx || { unreadBySender: {}, refreshDirectUnread: async () => undefined };
}
