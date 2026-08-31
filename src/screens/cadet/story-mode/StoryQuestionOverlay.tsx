import { BookOpen, Loader2 } from 'lucide-react';
import type { StoryQuestionPayload } from './types';

interface StoryQuestionOverlayProps {
  question: StoryQuestionPayload;
  remainingMs: number;
  selectedAnswer: string | null;
  submitting: boolean;
  onAnswer: (answer: string) => void;
}

export function StoryQuestionOverlay({ question, remainingMs, selectedAnswer, submitting, onAnswer }: StoryQuestionOverlayProps) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const ratio = Math.max(0, Math.min(1, remainingMs / (question.timerSeconds * 1_000)));
  return (
    <div className="absolute inset-x-2 top-14 z-30 mx-auto max-w-2xl rounded-lg border border-white/25 bg-navy/82 p-3 text-white shadow-2xl backdrop-blur-md sm:inset-x-5 sm:top-5 sm:p-4">
      <div className="flex items-start gap-3">
        <div
          className="story-timer-ring"
          style={{ '--story-timer-ratio': `${ratio * 360}deg` } as React.CSSProperties}
          aria-label={`${seconds} seconds remaining`}
          role="timer"
        >
          <span>{seconds}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-peri-dim">
            <span className="inline-flex items-center gap-1"><BookOpen size={11} /> {question.scriptureReference}</span>
            <span className="rounded-full border border-white/15 px-2 py-0.5 capitalize">{question.difficulty}</span>
          </div>
          <h3 className="mt-1.5 font-display text-base font-semibold leading-snug text-white sm:text-lg">{question.prompt}</h3>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {question.options.map((option, index) => (
          <button
            key={option}
            type="button"
            onClick={() => onAnswer(option)}
            disabled={submitting}
            aria-pressed={selectedAnswer === option}
            className={`story-answer-option ${selectedAnswer === option ? 'story-answer-selected' : ''}`}
          >
            <span>{String.fromCharCode(65 + index)}</span>
            <strong>{option}</strong>
            {submitting && selectedAnswer === option && <Loader2 size={14} className="ml-auto animate-spin" />}
          </button>
        ))}
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <div className={`h-full rounded-full transition-[width] duration-100 ${seconds <= 3 ? 'bg-coral' : 'bg-gold'}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
