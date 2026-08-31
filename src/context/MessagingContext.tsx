import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

interface MessagingContextValue {
  unreadBySender: Record<string, number>;
  refreshDirectUnread: () => Promise<void>;
}

const MessagingContext = createContext<MessagingContextValue | undefined>(undefined);

export function MessagingProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [unreadBySender, setUnreadBySender] = useState<Record<string, number>>({});
  const refreshRequestRef = useRef<Promise<void> | null>(null);

  const refreshDirectUnread = useCallback(() => {
    if (!profile?.id) {
      setUnreadBySender({});
      return Promise.resolve();
    }
    if (refreshRequestRef.current) return refreshRequestRef.current;

    const request = (async () => {
      const { data: unread, error } = await supabase
        .from('direct_messages')
        .select('sender_id')
        .eq('recipient_id', profile.id)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) return;
      const next: Record<string, number> = {};
      (unread || []).forEach((message: any) => {
        if (!message.sender_id || message.sender_id === profile.id) return;
        next[message.sender_id] = (next[message.sender_id] || 0) + 1;
      });
      setUnreadBySender(next);
    })();

    const shared = request.finally(() => {
      if (refreshRequestRef.current === shared) refreshRequestRef.current = null;
    });
    refreshRequestRef.current = shared;
    return shared;
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

  useEffect(() => {
    if (!profile?.id) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshDirectUnread();
    };
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    window.addEventListener('focus', refreshWhenVisible);
    window.addEventListener('online', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshWhenVisible);
      window.removeEventListener('online', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [profile?.id, refreshDirectUnread]);

  const value = useMemo(() => ({ unreadBySender, refreshDirectUnread }), [unreadBySender, refreshDirectUnread]);

  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>;
}

export function useMessaging() {
  const ctx = useContext(MessagingContext);
  return ctx || { unreadBySender: {}, refreshDirectUnread: async () => undefined };
}
