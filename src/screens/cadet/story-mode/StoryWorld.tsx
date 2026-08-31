import { Pause, Play } from 'lucide-react';
import { StoryCharacter } from './StoryCharacter';
import { storyPhaseProgress, type StoryMachineState, type StoryPhase } from './engine';
import type { StoryActionName, StoryEnvironment, StorySceneDefinition } from './types';

interface StoryWorldProps {
  machine: StoryMachineState;
  scene: StorySceneDefinition;
  action: StoryActionName;
  paused: boolean;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  children?: React.ReactNode;
}

function visualPhase(machine: StoryMachineState): StoryPhase {
  return machine.phase === 'paused' && machine.resumePhase ? machine.resumePhase : machine.phase;
}

export function StoryWorld({ machine, scene, action, paused, busy, onPause, onResume, children }: StoryWorldProps) {
  const phase = visualPhase(machine);
  const environment: StoryEnvironment = scene.environment;
  const characterLabel = scene.character === 'abel' ? 'Abel' : scene.character;
  const position = storyPhaseProgress(phase);
  const farShift = -Math.max(0, position - 10) * 0.08;
  const nearShift = -Math.max(0, position - 10) * 0.16;
  const fieldShift = -Math.max(0, position - 10) * 0.24;
  const correct = phase === 'correct_action' || phase === 'level_complete';
  const wrong = phase === 'wrong_action' || phase === 'failure';

  return (
    <section
      className={`story-world story-world-${environment.palette} story-time-${environment.timeOfDay} story-weather-${environment.weather} story-phase-${phase} ${correct ? 'story-outcome-correct' : ''} ${wrong ? 'story-outcome-wrong' : ''} ${paused ? 'story-is-paused' : ''}`}
      style={{
        '--story-character-x': `${position}%`,
        '--story-far-shift': `${farShift}%`,
        '--story-near-shift': `${nearShift}%`,
        '--story-field-shift': `${fieldShift}%`,
      } as React.CSSProperties}
      aria-label={`${characterLabel} in ${environment.id.replace(/-/g, ' ')}`}
    >
      <div className="story-sky" aria-hidden="true">
        <span className="story-sun" />
        <span className="story-cloud story-cloud-one" />
        <span className="story-cloud story-cloud-two" />
      </div>
      <div className="story-hills story-hills-far" aria-hidden="true" />
      <div className="story-hills story-hills-near" aria-hidden="true" />
      <div className="story-field-bands" aria-hidden="true" />
      <div className="story-grass story-grass-back" aria-hidden="true" />
      <div className="story-altar" aria-hidden="true">
        <span /><span /><span />
        <i className="story-altar-glow" />
      </div>
      <div className="story-offering story-offering-flock" aria-hidden="true">
        <span className="story-lamb-body" /><span className="story-lamb-head" /><span className="story-lamb-leg story-lamb-leg-one" /><span className="story-lamb-leg story-lamb-leg-two" />
      </div>
      <div className="story-offering story-offering-produce" aria-hidden="true">
        <span className="story-basket" /><span className="story-fruit story-fruit-one" /><span className="story-fruit story-fruit-two" /><span className="story-fruit story-fruit-three" />
      </div>
      <div className="story-character-track" aria-hidden="true">
        <StoryCharacter character={scene.character} action={action} />
      </div>
      <div className="story-grass story-grass-front" aria-hidden="true" />

      <div className="absolute left-3 top-3 z-30 flex items-center gap-2 sm:left-4 sm:top-4">
        <span className="rounded-md border border-white/20 bg-navy/55 px-2.5 py-1.5 text-[10px] font-bold text-white backdrop-blur-sm">
          Genesis 4
        </span>
      </div>
      <button
        type="button"
        onClick={paused ? onResume : onPause}
        disabled={busy}
        className="absolute right-3 top-3 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-navy/60 text-white shadow-lg backdrop-blur-sm disabled:opacity-50 sm:right-4 sm:top-4"
        title={paused ? 'Resume Story Mode' : 'Pause Story Mode'}
        aria-label={paused ? 'Resume Story Mode' : 'Pause Story Mode'}
      >
        {paused ? <Play size={17} fill="currentColor" /> : <Pause size={17} fill="currentColor" />}
      </button>

      {children}
    </section>
  );
}
