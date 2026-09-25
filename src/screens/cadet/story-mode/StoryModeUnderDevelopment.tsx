import { ArrowLeft, Hammer, Map } from 'lucide-react';

export function StoryModeUnderDevelopment({ onBackToDailyGames }: { onBackToDailyGames: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60svh] max-w-3xl items-center justify-center animate-fade-in">
      <section className="card w-full p-6 text-center sm:p-8">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-peri/30 bg-peri-soft text-peri">
          <Map size={24} />
        </span>
        <p className="eyebrow mt-4 text-peri">Story Mode</p>
        <h2 className="mt-1 font-display text-2xl font-semibold text-ink">Under Development</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-stone">The journey is being prepared and is not available to play yet.</p>
        <button type="button" onClick={onBackToDailyGames} className="btn-secondary mx-auto mt-6">
          <ArrowLeft size={15} /> Back to Daily Games <Hammer size={14} />
        </button>
      </section>
    </div>
  );
}
