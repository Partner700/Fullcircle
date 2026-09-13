import { supabase } from './supabase';
import type { AudioCall, AudioCallScope } from './types';

export const AUDIO_CALL_REQUEST_EVENT = 'full-circle-audio-call-request';
export const AUDIO_CALL_OPEN_EVENT = 'full-circle-audio-call-open';

export interface AudioCallRequestDetail {
  scope: AudioCallScope;
  tentId?: string | null;
}

function rpcMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return fallback;
}

export async function fetchMyActiveAudioCalls() {
  const { data, error } = await supabase.rpc('get_my_active_audio_calls');
  if (error) throw new Error(rpcMessage(error, 'Calls could not be loaded.'));
  return (Array.isArray(data) ? data : []) as AudioCall[];
}

export async function startAudioCall(scope: AudioCallScope, tentId?: string | null) {
  const { data, error } = await supabase.rpc('start_audio_call', {
    p_scope: scope,
    p_tent_id: tentId || null,
  });
  if (error) throw new Error(rpcMessage(error, 'The call could not be started.'));
  return data as AudioCall;
}

export async function answerAudioCall(callId: string, action: 'join' | 'decline' | 'leave') {
  const { data, error } = await supabase.rpc('answer_audio_call', {
    p_call_id: callId,
    p_action: action,
  });
  if (error) throw new Error(rpcMessage(error, 'The call could not be updated.'));
  return (data || null) as AudioCall | null;
}

export async function endAudioCall(callId: string) {
  const { error } = await supabase.rpc('end_audio_call', { p_call_id: callId });
  if (error) throw new Error(rpcMessage(error, 'The call could not be ended.'));
}

export function requestAudioCall(scope: AudioCallScope, tentId?: string | null) {
  window.dispatchEvent(new CustomEvent<AudioCallRequestDetail>(AUDIO_CALL_REQUEST_EVENT, {
    detail: { scope, tentId },
  }));
}

export function openAudioCall(callId: string) {
  window.dispatchEvent(new CustomEvent<{ callId: string }>(AUDIO_CALL_OPEN_EVENT, {
    detail: { callId },
  }));
}

export function audioCallIdFromLocation() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return query.get('fc-call') || hash.get('fc-call');
}

export function clearAudioCallLocation() {
  const url = new URL(window.location.href);
  let changed = false;
  if (url.searchParams.has('fc-call')) {
    url.searchParams.delete('fc-call');
    changed = true;
  }
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  if (hash.has('fc-call')) {
    hash.delete('fc-call');
    url.hash = hash.toString();
    changed = true;
  }
  if (changed) window.history.replaceState(window.history.state, '', url.toString());
}
