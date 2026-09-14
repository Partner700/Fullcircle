import { AudioCallManager } from './AudioCallManager';
import { BackgroundAlertPrompt } from './BackgroundAlertPrompt';
import { DenariiGainAnimation } from './DenariiGainAnimation';
import { DoveQuestionOverlay } from './DoveQuestionOverlay';
import { FoundersGiftPopup } from './FoundersGiftPopup';
import { HiddenChallengeOverlay } from './HiddenChallengeOverlay';
import { HiddenChallengeStatus } from './HiddenChallengeStatus';
import { ProfileCvHost } from './ProfileCvModal';
import { PublicQuizResultClaim } from './PublicQuizResultClaim';
import { ScriptureAlarmOverlay } from './ScriptureAlarmOverlay';

export function AuthenticatedOverlays() {
  return (
    <>
      <DenariiGainAnimation />
      <FoundersGiftPopup />
      <BackgroundAlertPrompt />
      <AudioCallManager />
      <ScriptureAlarmOverlay />
      <DoveQuestionOverlay />
      <HiddenChallengeOverlay />
      <HiddenChallengeStatus />
      <PublicQuizResultClaim />
      <ProfileCvHost />
    </>
  );
}
