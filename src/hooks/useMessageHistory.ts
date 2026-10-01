import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeMessagePage, type ChatMessage, type MessagePage, type MessagePageOptions } from '../lib/messagePages';

export function useMessageHistory(loadPage: (options: MessagePageOptions) => Promise<MessagePage>, enabled: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState('');
  const rows = useRef<ChatMessage[]>([]);
  const generation = useRef(0);
  const pending = useRef<Promise<void> | null>(null);
  const olderPending = useRef(false);
  const refreshAgain = useRef(false);

  const refresh = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve();
    if (pending.current) { refreshAgain.current = true; return pending.current; }
    const version = generation.current;
    const request = Promise.resolve().then(async () => {
      try {
        do {
          refreshAgain.current = false;
          const latest = rows.current[rows.current.length - 1];
          const page = await loadPage(latest ? { after: latest } : {});
          if (version !== generation.current) return;
          if (!latest) setHasOlder(page.hasMore);
          rows.current = mergeMessagePage(rows.current, page.messages);
          setMessages(rows.current);
          // Catch up missed messages in bounded pages after reconnecting.
          if (latest && page.hasMore) refreshAgain.current = true;
        } while (refreshAgain.current && version === generation.current);
        setError('');
      } catch {
        if (version === generation.current) setError('Messages could not refresh. Please try again.');
      } finally {
        if (version === generation.current) { pending.current = null; setLoading(false); }
      }
    });
    pending.current = request;
    return request;
  }, [enabled, loadPage]);

  const loadOlder = useCallback(async () => {
    if (!enabled || !hasOlder || olderPending.current || !rows.current[0]) return;
    olderPending.current = true;
    setLoadingOlder(true);
    const version = generation.current;
    try {
      const page = await loadPage({ before: rows.current[0] });
      if (version !== generation.current) return;
      rows.current = mergeMessagePage(rows.current, page.messages);
      setMessages(rows.current);
      setHasOlder(page.hasMore);
      setError('');
    } catch {
      if (version === generation.current) setError('Older messages could not load. Please try again.');
    } finally {
      if (version === generation.current) { olderPending.current = false; setLoadingOlder(false); }
    }
  }, [enabled, hasOlder, loadPage]);

  const update = useCallback((id: string, patch: Partial<ChatMessage>) => {
    rows.current = rows.current.map(row => row.id === id ? { ...row, ...patch } as ChatMessage : row);
    setMessages(rows.current);
  }, []);

  useEffect(() => {
    const effectGeneration = generation.current + 1;
    generation.current = effectGeneration;
    rows.current = [];
    pending.current = null;
    olderPending.current = false;
    setMessages([]);
    setHasOlder(false);
    setLoading(enabled);
    setLoadingOlder(false);
    setError('');
    void refresh();
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      if (generation.current === effectGeneration) generation.current++;
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [enabled, refresh]);

  return { messages, loading, loadingOlder, hasOlder, error, refresh, loadOlder, update };
}
