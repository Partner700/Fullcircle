import { supabase } from './supabase';
import type { PendingScriptureAlarm, ScriptureAlarmAnswerResult } from './types';

export async function fetchPendingScriptureAlarm() {
  const { data, error } = await supabase.rpc('get_pending_scripture_alarm');
  if (error) throw error;
  return (data || null) as PendingScriptureAlarm | null;
}

export async function submitScriptureAlarmAnswer(alarmId: string, answer: string) {
  const { data, error } = await supabase.rpc('submit_scripture_alarm_answer', {
    p_alarm_id: alarmId,
    p_answer: answer,
  });
  if (error) throw error;
  return data as ScriptureAlarmAnswerResult;
}
