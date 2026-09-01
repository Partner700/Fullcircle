import { Pause, Play } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { StoryCharacter } from './StoryCharacter';
import { STORY_CHARACTER_LABELS } from './characters';
import { findStoryBuild } from './content';
import { storyPhaseProgress, type StoryMachineState, type StoryPhase } from './engine';
import { StoryConstruction } from './StoryConstruction';
import { StoryEnvironmentEffects } from './StoryEnvironmentEffects';
import type { StoryActionName, StoryBuildState, StoryEnvironmentState, StorySceneDefinition } from './types';

interface StoryWorldProps {
  machine: StoryMachineState;
  scene: StorySceneDefinition;
  action: StoryActionName;
  scriptureLabel: string;
  paused: boolean;
  busy: boolean;
  buildState: StoryBuildState | null;
  environmentState: StoryEnvironmentState | null;
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

export function StoryWorld({ machine, scene, action, scriptureLabel, paused, busy, buildState, environmentState, onPause, onResume, children }: StoryWorldProps) {
  const phase = visualPhase(machine);
  const progressPosition = storyPhaseProgress(phase);
  const farShift = -Math.max(0, progressPosition - 10) * 0.08;
  const nearShift = -Math.max(0, progressPosition - 10) * 0.16;
  const fieldShift = -Math.max(0, progressPosition - 10) * 0.24;
  const correct = phase === 'correct_action' || phase === 'level_complete' || phase === 'chapter_complete' || phase === 'book_complete';
  const wrong = phase === 'wrong_action' || phase === 'failure';
  const labels = scene.characters.map((placement) => STORY_CHARACTER_LABELS[placement.id]).join(' and ') || 'the narrative';
  const timePassage = scene.environment.timePassage || 'none';
  const locomotion = scene.locomotion || 'walk';
  const elevation = scene.environment.elevation || 0;
  const travelDuration = `${scene.durationMs || 4_100}ms`;
  const buildDefinition = scene.constructionId ? findStoryBuild(scene.constructionId) : null;
  const visibleBuildState = buildDefinition && buildState?.constructionId === buildDefinition.id ? buildState : null;
  const environmentClasses = environmentState
    ? `story-environment-${environmentState.stageSlug} story-terrain-${environmentState.terrainState} story-traversal-${environmentState.traversalMode} story-ark-${environmentState.arkState}`
    : '';

  return (
    <section
      className={`story-world story-world-${scene.environment.palette} story-time-${scene.environment.timeOfDay} story-weather-${environmentState?.weather || scene.environment.weather} story-weather-intensity-${environmentState?.weatherIntensity ?? scene.environment.weatherIntensity ?? 0} story-passage-${timePassage} story-locomotion-${locomotion} story-elevation-${elevation} story-camera-${scene.camera?.framing || 'follow'} story-phase-${phase} ${environmentClasses} ${correct ? 'story-outcome-correct' : ''} ${wrong ? 'story-outcome-wrong' : ''} ${paused ? 'story-is-paused' : ''}`}
      style={{
        '--story-far-shift': `${farShift}%`,
        '--story-near-shift': `${nearShift}%`,
        '--story-field-shift': `${fieldShift}%`,
        '--story-travel-duration': travelDuration,
        '--story-elevation': elevation,
        '--story-elevation-far': `${elevation * -0.42}rem`,
        '--story-elevation-near': `${elevation * -0.57}rem`,
        '--story-elevation-field': `${elevation * -0.17}rem`,
      } as CSSProperties}
      aria-label={`${labels} in ${scene.environment.id.replace(/-/g, ' ')}`}
    >
      <div className="story-sky" aria-hidden="true">
        <span className="story-sun" />
        <span className="story-cloud story-cloud-one" />
        <span className="story-cloud story-cloud-two" />
        <span className="story-time-sweep" />
      </div>
      <div className="story-hills story-hills-far" aria-hidden="true" />
      <div className="story-hills story-hills-near" aria-hidden="true" />
      <div className="story-field-bands" aria-hidden="true" />
      <div className="story-grass story-grass-back" aria-hidden="true" />
      {environmentState ? <StoryEnvironmentEffects state={environmentState} /> : null}
      {scene.environment.palette === 'noah-corruption' ? (
        <div className="story-corruption-details" aria-hidden="true"><span /><span /><span /><span /></div>
      ) : null}
      {buildDefinition && visibleBuildState ? (
        <StoryConstruction
          definition={buildDefinition}
          state={visibleBuildState}
          failureEffect={wrong ? scene.buildFailureEffect : undefined}
        />
      ) : null}
      <div className={`story-altar ${environmentState?.altarVisible ? 'story-altar-visible' : ''}`} aria-hidden="true"><span /><span /><span /><i className="story-altar-glow" /></div>
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

      {scene.creatureGroups?.map((group) => (
        <div
          key={group.id}
          className={`story-creature-group story-creature-${group.category} story-creature-${group.state}`}
          style={{ '--story-group-x': `${group.x}%` } as CSSProperties}
          aria-label={`${group.category.replace(/-/g, ' ')} ${group.state}`}
        >
          <span /><span /><span />
        </div>
      ))}

      {scene.supplyGroups?.map((group) => (
        <div
          key={group.id}
          className={`story-supply-group story-supply-${group.kind} story-supply-${group.state}`}
          style={{ '--story-group-x': `${group.x}%` } as CSSProperties}
          aria-label={`${group.kind} ${group.state}`}
        >
          <span /><span /><span />
        </div>
      ))}

      {scene.characters.map((placement) => {
        const position = placement.id === scene.activeCharacterId && ['walking', 'running'].includes(phase)
          ? progressPosition
          : placement.x;
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

      {scene.lineage?.length ? (
        <div className="story-lineage-indicator" aria-label={`Lineage: ${scene.lineage.map((id) => STORY_CHARACTER_LABELS[id]).join(' to ')}`}>
          {scene.lineage.map((id, index) => (
            <span key={`${scene.id}-${id}`}><b>{STORY_CHARACTER_LABELS[id]}</b>{index < scene.lineage!.length - 1 ? <i aria-hidden="true">&rarr;</i> : null}</span>
          ))}
        </div>
      ) : null}
      {scene.transitionLabel ? <div className="story-transition-label" role="status">{scene.transitionLabel}</div> : null}
      {scene.titleReveal ? <div className="story-title-reveal" role="status">{scene.titleReveal}</div> : null}

      <div className="absolute left-3 top-3 z-30 flex items-center gap-2 sm:left-4 sm:top-4">
        <span className="rounded-md border border-white/20 bg-navy/55 px-2.5 py-1.5 text-[10px] font-bold text-white backdrop-blur-sm">
          {scriptureLabel}
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
