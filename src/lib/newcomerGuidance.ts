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
};

export async function fetchMyNewcomerGuidance() {
  const { data, error } = await supabase.rpc('get_my_newcomer_guidance');
  if (error) throw error;
  return data as NewcomerGuidanceState;
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
