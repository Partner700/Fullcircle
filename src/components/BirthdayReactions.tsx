import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchBirthdayConversation, saveBirthdayWish, setBirthdayReaction, type BirthdayConversation } from '../lib/birthdays';
import { updateReactionOptimistically } from '../lib/reactionState';
import type { DailyQuoteComment, ScheduledAnnouncement } from '../lib/types';
import { QuoteReactions } from './QuoteReactions';

const EMPTY_COMMENTS: DailyQuoteComment[] = [];

export function BirthdayReactions({ announcement, active, onOpenChange, onMessageOpenChange }: {
  announcement: ScheduledAnnouncement;
  active: boolean;
  onOpenChange: (open: boolean) => void;
  onMessageOpenChange: (open: boolean) => void;
}) {
  const { profile } = useAuth();
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Africa/Douala', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(announcement.publish_at));
  const date = ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
  const [conversation, setConversation] = useState<BirthdayConversation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++version.current;
    const result = await fetchBirthdayConversation(announcement.id, date);
    if (request === version.current) setConversation(result);
  }, [announcement.id, date]);

  useEffect(() => {
    if (!active || !profile?.id) return;
    let disposed = false;
    const cancelPendingRead = () => { version.current += 1; };
    const load = () => {
      if (busyRef.current || document.visibilityState !== 'visible') return;
      void refresh().then(() => { if (!disposed) setError(''); }).catch(() => { if (!disposed) setError('Birthday wishes could not load. Please try again.'); });
    };
    load();
    const timer = window.setInterval(load, 10000);
    document.addEventListener('visibilitychange', load);
    window.addEventListener('online', load);
    return () => {
      disposed = true;
      cancelPendingRead();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
      window.removeEventListener('online', load);
    };
  }, [active, profile?.id, refresh]);

  const comments = conversation?.comments || EMPTY_COMMENTS;
  const fetchComments = useCallback(async () => comments, [comments]);
  const wish = async (body: string, wishId?: string, parentId?: string) => {
    await saveBirthdayWish(announcement.id, date, body, wishId, parentId);
    await refresh();
  };
  const react = async (type: string) => {
    if (!profile || !conversation || busyRef.current) return;
    const previous = conversation;
    const reacted = !conversation.reactions[type]?.reacted;
    busyRef.current = true;
    version.current++;
    setBusy(true);
    setError('');
    setConversation({ ...conversation, reactions: updateReactionOptimistically({ birthday: conversation.reactions }, 'birthday', type, reacted, {
      user_id: profile.id, display_name: profile.display_name, avatar_url: profile.avatar_url,
    }).birthday });
    try {
      await setBirthdayReaction(announcement.id, date, type, reacted);
      await refresh();
    } catch {
      setConversation(previous);
      setError('Your reaction could not be saved. Please try again.');
    } finally { busyRef.current = false; setBusy(false); }
  };

  return <div className="w-full">
    <QuoteReactions
      state={conversation?.reactions}
      disabled={busy || !conversation}
      onReact={react}
      quoteUserId={announcement.id}
      quoteRecordDate={date}
      currentUserId={profile?.id}
      fetchComments={fetchComments}
      onComment={body => wish(body)}
      onReply={(body, parentId) => wish(body, undefined, parentId)}
      onEditComment={(id, body) => wish(body, id)}
      onCommentOpenChange={onOpenChange}
      onMessageOpenChange={onMessageOpenChange}
      commentsTitle="Birthday Wishes"
      commentButtonLabel="Birthday wishes"
      commentPlaceholder="Send a birthday wish..."
      emptyCommentsText="No birthday wishes yet."
      previewLimit={1}
    />
    {error && <p role="alert" className="mt-2 text-xs text-coral">{error}</p>}
  </div>;
}
