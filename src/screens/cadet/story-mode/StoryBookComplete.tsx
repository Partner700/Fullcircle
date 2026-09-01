import { BookOpen, CalendarDays, CheckCircle2, Coins, Flag, Leaf, Map, RotateCcw, Sparkles } from 'lucide-react';
import type { StoryBookCompletionStats } from './types';

interface StoryBookCompleteProps {
  stats: StoryBookCompletionStats;
  replay: boolean;
  busy: boolean;
  onReplayBook: () => void;
  onBrowse: () => void;
  onHome: () => void;
}

function completionDate(value: string | null) {
  if (!value) return 'Saved on completion';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

export function StoryBookComplete({ stats, replay, busy, onReplayBook, onBrowse, onHome }: StoryBookCompleteProps) {
  return (
    <div className="story-result-panel story-book-complete-panel" role="dialog" aria-modal="true" aria-labelledby="story-book-complete-title">
      <span className="story-result-symbol story-result-complete"><Sparkles size={26} /></span>
      <p className="eyebrow text-gold">Book I</p>
      <h3 id="story-book-complete-title">BEGINNINGS</h3>
      <strong className="story-book-complete-word">COMPLETE</strong>
      <p>From Abel through Noah, the required canonical journey is complete. The journey continues...</p>
      <div className="story-book-stat-grid">
        <span><BookOpen size={15} /><strong>{stats.chaptersCompleted}</strong><small>Chapters</small></span>
        <span><Flag size={15} /><strong>{stats.levelsCompleted}</strong><small>Levels</small></span>
        <span><CheckCircle2 size={15} /><strong>{stats.successfulResponses}/{stats.questionsEncountered}</strong><small>Correct</small></span>
        <span><Sparkles size={15} /><strong>{stats.completionPercentage}%</strong><small>Complete</small></span>
        <span><Leaf size={15} /><strong>{stats.figsEarned}</strong><small>Figs</small></span>
        <span><Coins size={15} /><strong>{stats.denariiEarned}</strong><small>Denarii</small></span>
        <span className="story-book-stat-date"><CalendarDays size={15} /><strong>{completionDate(stats.completedAt)}</strong><small>Completed</small></span>
      </div>
      {replay ? <p className="story-replay-note">Practice replay complete. Book progress and rewards remain unchanged.</p> : null}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onReplayBook} disabled={busy} className="btn-primary"><RotateCcw size={15} /> Replay Book</button>
        <button type="button" onClick={onBrowse} className="btn-secondary"><Map size={15} /> Browse Journey</button>
        <button type="button" onClick={onHome} className="btn-secondary"><BookOpen size={15} /> Story Mode Home</button>
      </div>
    </div>
  );
}
