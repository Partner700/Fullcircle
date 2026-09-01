import type { StoryEnvironmentState } from './types';

interface StoryEnvironmentEffectsProps {
  state: StoryEnvironmentState;
}

const RAIN_STREAKS = Array.from({ length: 12 }, (_, index) => index);

function statusText(state: StoryEnvironmentState) {
  const details = [
    state.weather !== 'none' ? `${state.weather.replace(/_/g, ' ')} weather` : null,
    state.waterStage > 0 ? `water stage ${state.waterStage}, ${state.waterTrend}` : null,
    state.birdKind !== 'none' ? `${state.birdKind} ${state.birdState.replace(/_/g, ' ')}` : null,
    state.oliveLeafVisible ? 'olive leaf visible' : null,
    state.altarVisible ? 'altar visible' : null,
    state.rainbowVisible ? 'rainbow visible' : null,
  ].filter(Boolean);
  return `${state.label}: ${state.stageSlug.replace(/-/g, ' ')}. ${details.join('. ')}.`;
}

export function StoryEnvironmentEffects({ state }: StoryEnvironmentEffectsProps) {
  const raining = state.weather === 'drizzle' || state.weather === 'rain' || state.weather === 'heavy_rain' || state.weather === 'storm';
  const birdVisible = state.birdKind !== 'none' && state.birdState !== 'none' && state.birdState !== 'no_return';

  return (
    <>
      {raining ? (
        <div className={`story-rain story-rain-intensity-${state.weatherIntensity}`} aria-hidden="true">
          {RAIN_STREAKS.map((streak) => <span key={streak} />)}
        </div>
      ) : null}
      <div
        className={`story-flood-water story-water-stage-${state.waterStage} story-water-${state.waterTrend}`}
        aria-hidden="true"
      >
        <span className="story-water-surface" />
      </div>
      {birdVisible ? (
        <div className={`story-bird story-bird-${state.birdKind} story-bird-${state.birdState}`} aria-hidden="true">
          <span className="story-bird-body" />
          <span className="story-bird-wing story-bird-wing-left" />
          <span className="story-bird-wing story-bird-wing-right" />
          {state.oliveLeafVisible ? <i className="story-olive-leaf" /> : null}
        </div>
      ) : null}
      {state.rainbowVisible ? <div className="story-rainbow" aria-hidden="true" /> : null}
      <p className="sr-only" role="status" aria-live="polite">{statusText(state)}</p>
    </>
  );
}
