import type { StoryBuildDefinition, StoryBuildFailureEffect, StoryBuildState } from './types';

interface StoryConstructionProps {
  definition: StoryBuildDefinition;
  state: StoryBuildState;
  failureEffect?: StoryBuildFailureEffect;
}

export function StoryConstruction({ definition, state, failureEffect }: StoryConstructionProps) {
  const completedStages = definition.stages.filter((stage) => stage.order <= state.stageOrder);
  const currentLabel = completedStages[completedStages.length - 1]?.label || 'Construction site prepared';

  return (
    <div
      className={`story-construction story-construction-${definition.visual} story-build-stage-${state.stageOrder} ${failureEffect ? `story-build-failure-${failureEffect}` : ''}`}
      data-construction-id={definition.id}
      data-stage={state.stageOrder}
    >
      <div className="story-build-ground" aria-hidden="true" />
      <div className="story-build-object" aria-hidden="true">
        {completedStages.map((stage) => (
          <span
            key={stage.id}
            className={`story-build-piece story-build-piece-${stage.componentKey}`}
            data-build-component={stage.componentKey}
          />
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {definition.label}: stage {state.stageOrder} of {state.totalStages}. {currentLabel}.
      </p>
    </div>
  );
}
