import { supabase } from './supabase';

export type ValedictionDraftReview = {
 generated_at?: string | null;
 validated: boolean;
 validated_at?: string | null;
 sources: Record<string, number>;
 question_count?: number;
};
export async function generateValedictionDraft(sessionId: string, count = 50) {
 const { data, error } = await supabase.rpc('generate_valediction_draft', { p_session: sessionId, p_count: count });
 if (error) throw error;
 return data as ValedictionDraftReview;
}
export async function fetchValedictionDraftReview(sessionId: string) {
 const { data, error } = await supabase.rpc('get_valediction_draft_review', { p_session: sessionId });
 if (error) throw error;
 return data as ValedictionDraftReview;
}
export async function validateValedictionDraft(sessionId: string) {
 const { data, error } = await supabase.rpc('validate_valediction_draft', { p_session: sessionId });
 if (error) throw error;
 return data as ValedictionDraftReview;
}
