import { Flame, Heart, ThumbsUp } from 'lucide-react';
import { cn } from '../lib/utils';
import type { AwardReactionState } from '../lib/queries';
import { MessageAvatar } from './TentMessenger';

const REACTIONS = [
  { type: 'celebrate', label: 'Celebrate', icon: ThumbsUp },
  { type: 'fire', label: 'Outstanding', icon: Flame },
  { type: 'love', label: 'Love', icon: Heart },
];

export function AwardReactions({ state = {}, disabled = false, currentUserId, onMessageOpenChange, onReact }: {
  state?: AwardReactionState;
  disabled?: boolean;
  currentUserId?: string;
  onMessageOpenChange?: (open: boolean) => void;
  onReact: (reactionType: string) => void;
}) {
  const actors = Array.from(new Map(
    REACTIONS.flatMap(({ type }) => state[type]?.actors || []).map((actor) => [actor.user_id, actor]),
  ).values()).slice(0, 5);

  return (
    <div className="mt-2 space-y-1.5" aria-label="Award reactions">
      <div className="flex flex-wrap items-center gap-1.5">
        {REACTIONS.map(({ type, label, icon: Icon }) => {
          const reaction = state[type] || { count: 0, reacted: false, actors: [] };
          return (
            <button
              key={type}
              type="button"
              disabled={disabled}
              onClick={() => onReact(type)}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[11px] transition-colors disabled:opacity-50',
                reaction.reacted ? 'border-gold/60 bg-gold-soft text-gold' : 'border-border bg-surface/70 text-stone hover:text-ink',
              )}
              title={label}
              aria-pressed={reaction.reacted}
            >
              <Icon size={12} />
              <span>{reaction.count}</span>
            </button>
          );
        })}
      </div>
      {actors.length > 0 && (
        <div className="flex items-center -space-x-4" aria-label={`${actors.length} camp members reacted`}>
          {actors.map((actor) => (
            <MessageAvatar
              key={actor.user_id}
              profile={{
                id: actor.user_id,
                display_name: actor.display_name,
                email: null,
                avatar_url: actor.avatar_url,
                whatsapp_number: null,
                language_code: null,
                country_code: null,
                created_at: '',
              }}
              currentUserId={currentUserId}
              size="xs"
              onOpenChange={onMessageOpenChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
