import { supabase } from './supabase';
import type {
  DoveQuestion,
  DoveQuestionAnswerResult,
  DoveQuestionParticipant,
  PendingDoveQuestion,
  PublishDoveQuestionInput,
} from './types';

export async function publishDoveQuestion(input: PublishDoveQuestionInput) {
  const { data, error } = await supabase.rpc('publish_dove_question', {
    p_question_text: input.questionText,
    p_question_type: input.questionType,
    p_options: input.options,
    p_correct_answer: input.correctAnswer,
    p_accepted_answers: input.acceptedAnswers,
    p_explanation: input.explanation || null,
    p_entry_cost_denarii: input.entryCostDenarii,
    p_reward_denarii: input.rewardDenarii,
    p_delivery_mode: input.deliveryMode,
    p_sound_url: input.soundUrl || null,
    p_expires_at: input.expiresAt || null,
  });
  if (error) throw error;
  return data as string;
}

export async function fetchPendingDoveQuestion() {
  const { data, error } = await supabase.rpc('get_pending_dove_question');
  if (error) throw error;
  return (data || null) as PendingDoveQuestion | null;
}

export async function fetchDoveQuestionParticipants(questionId: string) {
  const { data, error } = await supabase.rpc('get_dove_question_participants', {
    p_question_id: questionId,
  });
  if (error) throw error;
  return (data || []) as DoveQuestionParticipant[];
}

export async function fetchInstructorDoveQuestionParticipants(questionIds: string[]) {
  if (questionIds.length === 0) return [] as Array<DoveQuestionParticipant & { question_id: string }>;
  const { data, error } = await supabase.rpc('get_dove_question_participants_for_instructor', {
    p_question_ids: questionIds,
  });
  if (error) throw error;
  return (data || []) as Array<DoveQuestionParticipant & { question_id: string }>;
}

export async function submitDoveQuestionAnswer(questionId: string, answer: string) {
  const { data, error } = await supabase.rpc('submit_dove_question_answer', {
    p_question_id: questionId,
    p_answer: answer,
  });
  if (error) throw error;
  return data as DoveQuestionAnswerResult;
}

export async function dismissDoveQuestion(questionId: string) {
  const { data, error } = await supabase.rpc('dismiss_dove_question', {
    p_question_id: questionId,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function fetchInstructorDoveQuestions(limit = 24) {
  const { data, error } = await supabase
    .from('dove_questions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as DoveQuestion[];
}

export async function closeDoveQuestion(questionId: string) {
  const { data, error } = await supabase.rpc('close_dove_question', {
    p_question_id: questionId,
  });
  if (error) throw error;
  return Boolean(data);
}
