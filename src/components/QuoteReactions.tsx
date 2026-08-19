import { useEffect, useState } from 'react';
import { Flame, HeartHandshake, Lightbulb, Loader2, MessageCircle, Reply, Send } from 'lucide-react';
import { cn } from '../lib/utils';
import type { DailyQuoteComment } from '../lib/types';
import { MessageAvatar } from './TentMessenger';

export type QuoteReactionState = Record<string, { count: number; reacted: boolean }>;

const REACTIONS = [
  { type: 'amen', label: 'Amen', icon: HeartHandshake },
  { type: 'spark', label: 'Fire', icon: Flame },
  { type: 'thoughtful', label: 'Think', icon: Lightbulb },
];

const reactionButtonClass = 'inline-flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-full border px-1.5 text-[11px] font-bold transition-colors';

export function QuoteReactions({
  state,
  disabled,
  onReact,
  quoteUserId,
  quoteRecordDate,
  currentUserId,
  fetchComments,
  onComment,
  onReply,
  onCommentOpenChange,
  onMessageOpenChange,
  previewLimit = 2,
}: {
  state?: QuoteReactionState;
  disabled?: boolean;
  onReact: (reactionType: string) => void;
  quoteUserId?: string;
  quoteRecordDate?: string;
  currentUserId?: string;
  fetchComments?: (quoteUserId: string, quoteRecordDate: string) => Promise<DailyQuoteComment[]>;
  onComment?: (body: string) => Promise<void>;
  onReply?: (body: string, parentCommentId: string, mentionedUserIds: string[]) => Promise<void>;
  onCommentOpenChange?: (open: boolean) => void;
  onMessageOpenChange?: (open: boolean) => void;
  previewLimit?: number;
}) {
  const [comments, setComments] = useState<DailyQuoteComment[]>([]);
  const [body, setBody] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [replyTarget, setReplyTarget] = useState<DailyQuoteComment | null>(null);
  const commentsEnabled = Boolean(quoteUserId && quoteRecordDate && fetchComments && onComment && currentUserId);
  const commentsPanelOpen = commentsEnabled && (showComments || Boolean(replyTarget));

  useEffect(() => {
    onCommentOpenChange?.(commentsPanelOpen);
    return () => onCommentOpenChange?.(false);
  }, [commentsPanelOpen, onCommentOpenChange]);

  useEffect(() => {
    if (!commentsEnabled || !quoteUserId || !quoteRecordDate || !fetchComments) {
      setComments([]);
      return;
    }
    let cancelled = false;
    setLoadingComments(true);
    fetchComments(quoteUserId, quoteRecordDate)
      .then((items) => { if (!cancelled) setComments(items); })
      .catch(() => { if (!cancelled) setCommentError('Comments need setup before they can load.'); })
      .finally(() => { if (!cancelled) setLoadingComments(false); });
    return () => { cancelled = true; };
  }, [commentsEnabled, fetchComments, quoteRecordDate, quoteUserId]);

  const submitComment = async () => {
    if (!onComment || !body.trim()) return;
    setCommentError(null);
    setCommenting(true);
    try {
      if (replyTarget && onReply) {
        await onReply(body.trim(), replyTarget.id, [replyTarget.commenter_user_id]);
      } else {
        await onComment(body.trim());
      }
      setBody('');
      setReplyTarget(null);
      if (quoteUserId && quoteRecordDate && fetchComments) {
        setComments(await fetchComments(quoteUserId, quoteRecordDate));
      }
    } catch (err: any) {
      setCommentError(err?.message || 'Could not post comment.');
    }
    setCommenting(false);
  };

  const commentTotal = Math.max(Number(state?.comments?.count || 0), comments.length);
  const previewComments = comments.slice(0, Math.max(0, previewLimit));
  const topLevelComments = comments.filter((comment) => !comment.parent_comment_id);
  const repliesByParent = comments.reduce<Record<string, DailyQuoteComment[]>>((map, comment) => {
    if (comment.parent_comment_id) {
      if (!map[comment.parent_comment_id]) map[comment.parent_comment_id] = [];
      map[comment.parent_comment_id].push(comment);
    }
    return map;
  }, {});

  return (
    <div className="mt-6 space-y-3 pt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {REACTIONS.map((reaction) => {
          const Icon = reaction.icon;
          const data = state?.[reaction.type] || { count: 0, reacted: false };
          return (
            <button
              key={reaction.type}
              type="button"
              disabled={disabled || data.reacted}
              onClick={() => onReact(reaction.type)}
              className={cn(
                reactionButtonClass,
                data.reacted
                  ? 'border-brass/50 bg-brass-soft text-brass'
                  : 'border-border bg-surface-2 text-stone hover:border-brass/40 hover:text-brass',
              )}
              title={reaction.label}
              aria-label={`${reaction.label}: ${data.count} reactions`}
            >
              <Icon size={12} />
              <span className="text-[10px] opacity-85">{data.count}</span>
            </button>
          );
        })}
        {commentsEnabled && (
          <button
            type="button"
            onClick={() => setShowComments(true)}
            className={cn(reactionButtonClass, 'border-border bg-surface-2 text-stone hover:border-royal/40 hover:text-royal')}
            title="Comments"
            aria-label={`${commentTotal} comments`}
          >
            <MessageCircle size={12} /> <span className="text-[10px] opacity-85">{commentTotal}</span>
          </button>
        )}
      </div>

      {commentsEnabled && previewComments.length > 0 && (
        <div className="space-y-1.5">
          {previewComments.map((comment) => (
            <div key={comment.id} className="flex items-start gap-2 rounded-xl border border-border bg-surface-2/90 px-2.5 py-2">
              <MessageAvatar
                profile={{
                  id: comment.commenter_user_id,
                  display_name: comment.display_name || 'User',
                  email: null,
                  avatar_url: comment.avatar_url,
                  whatsapp_number: null,
                  language_code: null,
                  country_code: null,
                  created_at: comment.created_at,
                }}
                currentUserId={currentUserId}
                size="sm"
                onOpenChange={onMessageOpenChange || onCommentOpenChange}
              />
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold text-ink">{comment.display_name || 'User'}</p>
                <p className="line-clamp-2 text-xs leading-snug text-stone">{comment.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {commentsEnabled && showComments && (
        <div className="mt-3 rounded-2xl border border-royal/25 bg-surface/95 p-4 shadow-sm animate-slide-up">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-semibold text-ink">Quote Comments</h3>
              <p className="text-xs text-stone">Visible to cadets, sentries, and instructors.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setReplyTarget(null);
                setBody('');
                setShowComments(false);
              }}
              className="btn-ghost text-xs px-2 py-1"
            >
              Hide
            </button>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {loadingComments && <p className="text-xs text-stone flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading comments...</p>}
            {!loadingComments && comments.length === 0 && <p className="text-xs text-stone">No comments yet.</p>}
            {topLevelComments.map((comment) => (
              <div key={comment.id} className="space-y-2">
                <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-2">
                  <MessageAvatar
                    profile={{
                      id: comment.commenter_user_id,
                      display_name: comment.display_name || 'User',
                      email: null,
                      avatar_url: comment.avatar_url,
                      whatsapp_number: null,
                      language_code: null,
                      country_code: null,
                      created_at: comment.created_at,
                    }}
                    currentUserId={currentUserId}
                    size="sm"
                    onOpenChange={onMessageOpenChange || onCommentOpenChange}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-ink">
                      {comment.display_name} <span className="font-medium text-brass">({comment.rank_label})</span>
                    </p>
                    <p className="text-sm text-stone leading-snug">{comment.body}</p>
                    <button
                      type="button"
                      className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-peri"
                      onClick={() => {
                        setReplyTarget(comment);
                        setBody(`@${comment.display_name || 'User'} `);
                      }}
                    >
                      <Reply size={11} /> Reply
                    </button>
                  </div>
                </div>
                {(repliesByParent[comment.id] || []).map((reply) => (
                  <div key={reply.id} className="ml-8 flex items-start gap-2 rounded-lg border border-border bg-surface/75 p-2">
                    <MessageAvatar
                      profile={{
                        id: reply.commenter_user_id,
                        display_name: reply.display_name || 'User',
                        email: null,
                        avatar_url: reply.avatar_url,
                        whatsapp_number: null,
                        language_code: null,
                        country_code: null,
                        created_at: reply.created_at,
                      }}
                      currentUserId={currentUserId}
                      size="sm"
                      onOpenChange={onMessageOpenChange || onCommentOpenChange}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold text-ink">{reply.display_name || 'User'}</p>
                      <p className="text-xs leading-snug text-stone">{reply.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {replyTarget && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-peri/25 bg-peri-soft px-3 py-2">
              <p className="min-w-0 truncate text-[11px] font-semibold text-peri">Replying to @{replyTarget.display_name || 'User'}</p>
              <button type="button" className="text-[10px] font-bold text-stone hover:text-ink" onClick={() => { setReplyTarget(null); setBody(''); }}>
                Cancel
              </button>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <input
              className="input-field text-sm"
              maxLength={500}
              placeholder={replyTarget ? `Reply to ${replyTarget.display_name || 'this comment'}...` : 'Comment on this quote...'}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void submitComment(); }}
            />
            <button type="button" onClick={submitComment} disabled={!body.trim() || commenting} className="btn-primary px-3">
              {commenting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
          {commentError && <p className="mt-2 text-[10px] text-coral">{commentError}</p>}
        </div>
      )}
    </div>
  );
}
