export const OPEN_PROFILE_CV_EVENT = 'full-circle-open-profile-cv';

export function openProfileCv(userId?: string | null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_PROFILE_CV_EVENT, {
    detail: { userId: userId || null },
  }));
}
