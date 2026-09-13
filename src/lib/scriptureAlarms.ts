import { supabase } from './supabase';
import type { PendingScriptureAlarm, ScriptureAlarmAnswerResult } from './types';

export type PersonalAlarm = {
  id: string; title: string; alarm_time: string; timezone: string;
  repeat_days: number[]; once_date: string | null; enabled: boolean;
};

export async function fetchPersonalAlarms() {
  const { data, error } = await supabase.from('personal_alarms').select('id,title,alarm_time,timezone,repeat_days,once_date,enabled').order('alarm_time');
  if (error) throw error;
  return (data || []) as PersonalAlarm[];
}

export async function savePersonalAlarm(alarm: Omit<PersonalAlarm, 'id'> & { id?: string }) {
  const { error } = await supabase.rpc('save_personal_alarm', {
    p_id: alarm.id || null, p_title: alarm.title, p_time: alarm.alarm_time,
    p_timezone: alarm.timezone, p_repeat_days: alarm.repeat_days,
    p_once_date: alarm.once_date, p_enabled: alarm.enabled,
  });
  if (error) throw error;
}

export async function deletePersonalAlarm(id: string) {
  const { error } = await supabase.rpc('delete_personal_alarm', { p_id: id });
  if (error) throw error;
}

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
