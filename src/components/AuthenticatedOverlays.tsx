import { useEffect, useState } from 'react';
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
  const [secondaryReady, setSecondaryReady] = useState(false);

  useEffect(() => {
    // Alarms, calls and live questions are time-sensitive. Less urgent account
    // helpers wait until the dashboard and its first images have had the
    // connection to themselves, which is especially important in iOS Safari.
    const timer = window.setTimeout(() => setSecondaryReady(true), 3_500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      <DenariiGainAnimation />
      <BackgroundAlertPrompt />
      <AudioCallManager />
      <ScriptureAlarmOverlay />
      <DoveQuestionOverlay />
      <ProfileCvHost />
      {secondaryReady && (
        <>
          <FoundersGiftPopup />
          <HiddenChallengeOverlay />
          <HiddenChallengeStatus />
          <PublicQuizResultClaim />
        </>
      )}
    </>
  );
}
