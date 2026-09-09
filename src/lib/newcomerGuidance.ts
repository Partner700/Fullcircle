import { supabase } from './supabase';

export const NEWCOMER_GUIDANCE_REFRESH_EVENT = 'full-circle-newcomer-guidance-refresh';
export const OPEN_APP_NAVIGATION_EVENT = 'full-circle-open-app-navigation';

export type NewcomerGuidanceStep =
  | 'choose_tent'
  | 'dashboard_after_tent'
  | 'daily_scriptures'
  | 'scroll_reading'
  | 'best_verse'
  | 'meditation'
  | 'daily_quote'
  | 'dashboard_games'
  | 'daily_games'
  | 'daily_trivia'
  | 'complete';

export type NewcomerGuidanceState = {
  current_step: NewcomerGuidanceStep;
  completed: boolean;
  completed_at: string | null;
  guide_version?: number;
};

function isGuidanceState(value: unknown): value is NewcomerGuidanceState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<NewcomerGuidanceState>;
  return typeof candidate.current_step === 'string' && typeof candidate.completed === 'boolean';
}

async function fetchTentlessGuidanceFallback(userId: string): Promise<NewcomerGuidanceState | null> {
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

  return {
    current_step: pendingRequest ? 'dashboard_after_tent' : 'choose_tent',
    completed: false,
    completed_at: null,
    guide_version: 2,
  };
}

export async function fetchMyNewcomerGuidance(userId?: string) {
  const { data, error } = await supabase.rpc('get_my_newcomer_guidance');
  if (!error && isGuidanceState(data)) {
    // Releases before guide v2 marked established accounts complete without
    // ever showing the tour. Do not let that stale response hide it from a
    // person who still has no tent while the database rollout catches up.
    if (userId && data.completed && Number(data.guide_version || 0) < 2) {
      try {
        return (await fetchTentlessGuidanceFallback(userId)) || data;
      } catch {
        return data;
      }
    }
    return data;
  }

  // CadetApp is also the safe fallback route when a new account's role row is
  // still settling. Membership is enough to keep the tent-choice tour visible
  // while an RPC rollout or a brief mobile connection recovers.
  if (userId) return fetchTentlessGuidanceFallback(userId);
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
