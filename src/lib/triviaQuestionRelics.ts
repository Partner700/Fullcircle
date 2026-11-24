import { supabase } from './supabase';

export const TRIVIA_QUESTION_RELICS = ['witch-ball-endor', 'reveal-reference', 'freeze-timer'] as const;

export type TriviaQuestionRelics = {
  used: string[];
  answer?: string;
  reference?: string;
  deadline?: string;
  extended?: boolean;
  hasReference?: boolean;
};

export async function classicTriviaRelic(roomId: string, questionIndex: number, slug?: string) {
  const { data, error } = await supabase.rpc('classic_trivia_relic', {
    p_room_id: roomId, p_question_index: questionIndex, p_slug: slug ?? null,
  });
  if (error) throw error;
  return data as TriviaQuestionRelics;
}

export async function preludeQuestionRelic(roomId: string, version: number, slug: string) {
  const { data, error } = await supabase.rpc('prelude_question_relic', {
    p_room_id: roomId, p_version: version, p_slug: slug,
  });
  if (error) throw error;
  return data as TriviaQuestionRelics;
}
