import { Pause, Play } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { StoryCharacter } from './StoryCharacter';
import { storyPhaseProgress, type StoryMachineState, type StoryPhase } from './engine';
import type { StoryActionName, StorySceneDefinition } from './types';

interface StoryWorldProps {
  machine: StoryMachineState;
  scene: StorySceneDefinition;
  action: StoryActionName;
  paused: boolean;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  children?: ReactNode;
}

function visualPhase(machine: StoryMachineState): StoryPhase {
  return machine.phase === 'paused' && machine.resumePhase ? machine.resumePhase : machine.phase;
}

function obstacleStyle(x: number, scale = 1): CSSProperties {
  return { left: `${x}%`, transform: `translateX(-50%) scale(${scale})` };
}

export function StoryWorld({ machine, scene, action, paused, busy, onPause, onResume, children }: StoryWorldProps) {
  const phase = visualPhase(machine);
  const progressPosition = storyPhaseProgress(phase);
  const farShift = -Math.max(0, progressPosition - 10) * 0.08;
  const nearShift = -Math.max(0, progressPosition - 10) * 0.16;
  const fieldShift = -Math.max(0, progressPosition - 10) * 0.24;
  const correct = phase === 'correct_action' || phase === 'level_complete' || phase === 'chapter_complete';
  const wrong = phase === 'wrong_action' || phase === 'failure';
  const labels = scene.characters.map((placement) => placement.id).join(' and ') || 'the narrative';

  return (
    <section
      className={`story-world story-world-${scene.environment.palette} story-time-${scene.environment.timeOfDay} story-weather-${scene.environment.weather} story-phase-${phase} ${correct ? 'story-outcome-correct' : ''} ${wrong ? 'story-outcome-wrong' : ''} ${paused ? 'story-is-paused' : ''}`}
      style={{
        '--story-far-shift': `${farShift}%`,
        '--story-near-shift': `${nearShift}%`,
        '--story-field-shift': `${fieldShift}%`,
      } as CSSProperties}
      aria-label={`${labels} in ${scene.environment.id.replace(/-/g, ' ')}`}
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
      <div className="story-altar" aria-hidden="true"><span /><span /><span /><i className="story-altar-glow" /></div>
      <div className="story-offering story-offering-flock" aria-hidden="true">
        <span className="story-lamb-body" /><span className="story-lamb-head" />
        <span className="story-lamb-leg story-lamb-leg-one" /><span className="story-lamb-leg story-lamb-leg-two" />
      </div>
      <div className="story-offering story-offering-produce" aria-hidden="true">
        <span className="story-basket" /><span className="story-fruit story-fruit-one" />
        <span className="story-fruit story-fruit-two" /><span className="story-fruit story-fruit-three" />
      </div>

      {scene.obstacles?.map((obstacle) => (
        <span
          key={obstacle.id}
          className={`story-obstacle story-obstacle-${obstacle.type}`}
          style={obstacleStyle(obstacle.x, obstacle.scale)}
          aria-hidden="true"
        />
      ))}

      {scene.characters.map((placement) => {
        const position = placement.active && ['walking', 'running'].includes(phase) ? progressPosition : placement.x;
        const characterAction = placement.id === scene.activeCharacterId ? action : placement.action;
        return (
          <div
            key={`${scene.id}-${placement.id}`}
            className={`story-character-track story-character-track-${placement.role}`}
            style={{ left: `${position}%` } as CSSProperties}
          >
            <StoryCharacter character={placement.id} role={placement.role} action={characterAction} facing={placement.facing} />
          </div>
        );
      })}
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
