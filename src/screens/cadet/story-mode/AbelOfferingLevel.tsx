import { ABEL_OFFERING_LEVEL } from './content';
import { StoryLevelPlayer, type StoryLevelPlayerProps } from './StoryLevelPlayer';

type AbelOfferingLevelProps = Omit<StoryLevelPlayerProps, 'level'>;

export function AbelOfferingLevel(props: AbelOfferingLevelProps) {
  return <StoryLevelPlayer {...props} level={ABEL_OFFERING_LEVEL} />;
}
