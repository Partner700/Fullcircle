import { Flame, Heart, ThumbsUp } from 'lucide-react';
import { cn } from '../lib/utils';
import type { AwardReactionState } from '../lib/queries';

const REACTIONS = [
  { type: 'celebrate', label: 'Celebrate', icon: ThumbsUp },
  { type: 'fire', label: 'Outstanding', icon: Flame },
  { type: 'love', label: 'Love', icon: Heart },
];

export function AwardReactions({ state = {}, disabled = false, onReact }: {
  state?: AwardReactionState;
  disabled?: boolean;
  onReact: (reactionType: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Award reactions">
      {REACTIONS.map(({ type, label, icon: Icon }) => {
        const reaction = state[type] || { count: 0, reacted: false };
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
  );
}
