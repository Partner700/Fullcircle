import { supabase } from './supabase';

export const NEWCOMER_GUIDANCE_REFRESH_EVENT = 'full-circle-newcomer-guidance-refresh';
export const OPEN_APP_NAVIGATION_EVENT = 'full-circle-open-app-navigation';
export const NEWCOMER_GUIDANCE_ACTION_EVENT = 'full-circle-newcomer-guidance-action';
export const NEWCOMER_GUIDANCE_HERO_EVENT = 'full-circle-newcomer-guidance-hero';

export type NewcomerGuidanceStep =
  | 'choose_tent'
  | 'dashboard_after_tent'
  | 'daily_scriptures'
  | 'scroll_reading'
  | 'best_verse'
  | 'meditation'
  | 'daily_quote'
  | 'dashboard_games'
  | 'welcome_swipe_to_verse'
  | 'welcome_like_verse'
  | 'welcome_comment_verse'
  | 'welcome_swipe_to_quote'
  | 'welcome_like_quote'
  | 'welcome_comment_quote'
  | 'daily_games'
  | 'daily_trivia'
  | 'await_first_streak'
  | 'profile_settings'
  | 'profile_photo'
  | 'profile_details'
  | 'complete';

export type NewcomerGuidanceState = {
  current_step: NewcomerGuidanceStep;
  completed: boolean;
  completed_at: string | null;
  guide_version?: number;
};

export type NewcomerGuidanceAction =
  | 'welcome_swiped'
  | 'welcome_verse_reacted'
  | 'welcome_verse_commented'
  | 'welcome_quote_reacted'
  | 'welcome_quote_commented'
  | 'profile_photo_saved'
  | 'profile_details_saved';

export type NewcomerGuidanceHeroTarget = 'welcome' | 'verse' | 'other_quote' | null;

export function announceNewcomerGuidanceAction(action: NewcomerGuidanceAction) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NEWCOMER_GUIDANCE_ACTION_EVENT, { detail: { action } }));
}

export function directNewcomerGuidanceHero(target: NewcomerGuidanceHeroTarget, paused: boolean) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NEWCOMER_GUIDANCE_HERO_EVENT, { detail: { target, paused } }));
}

function isGuidanceState(value: unknown): value is NewcomerGuidanceState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<NewcomerGuidanceState>;
  return typeof candidate.current_step === 'string' && typeof candidate.completed === 'boolean';
}

async function fetchTentlessGuidanceFallback(userId: string, role?: string | null): Promise<NewcomerGuidanceState | null> {
  if (role === 'sentry' || role === 'instructor') {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return !profile?.avatar_url ? {
      current_step: 'profile_settings',
      completed: false,
      completed_at: null,
      guide_version: 4,
    } : null;
  }

  const { data: membership, error: membershipError } = await supabase
    .from('tent_members')
    .select('tent_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (membership) return null;

  const { data: pendingRequest, error: pendingError } = await supabase
    .from('tent_join_requests')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();
  if (pendingError) throw pendingError;

  if (!membership) {
    return {
      current_step: pendingRequest ? 'dashboard_after_tent' : 'choose_tent',
      completed: false,
      completed_at: null,
      guide_version: 4,
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.avatar_url) {
    return {
      current_step: 'profile_settings',
      completed: false,
      completed_at: null,
      guide_version: 4,
    };
  }

  return null;
}

export async function fetchMyNewcomerGuidance(userId?: string, role?: string | null) {
  const { data, error } = await supabase.rpc('get_my_newcomer_guidance');
  if (!error && isGuidanceState(data)) {
    // Releases before guide v3 can return a stale completed state while the
    // expanded tour is rolling out. Keep the tent choice visible meanwhile.
    if (userId && (data.completed || Number(data.guide_version || 0) < 4)) {
      try {
        return (await fetchTentlessGuidanceFallback(userId, role)) || data;
      } catch {
        return data;
      }
    }
    return data;
  }

  // CadetApp is also the safe fallback route when a new account's role row is
  // still settling. Membership is enough to keep the tent-choice tour visible
  // while an RPC rollout or a brief mobile connection recovers.
  if (userId) return fetchTentlessGuidanceFallback(userId, role);
  if (error) throw error;
  throw new Error('Newcomer guidance returned an invalid response.');
}

export async function completeNewcomerGuidanceStep(step: NewcomerGuidanceStep) {
  const { data, error } = await supabase.rpc('advance_my_newcomer_guidance', {
    p_completed_step: step,
  });
  if (error) throw error;
  const next = data as NewcomerGuidanceState;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NEWCOMER_GUIDANCE_REFRESH_EVENT, { detail: next }));
  }
  return next;
}
