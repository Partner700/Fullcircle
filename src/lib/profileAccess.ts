import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from './types';

function isMissingProfileRpc(error: PostgrestError | null) {
  if (!error) return false;
  return error.code === 'PGRST202'
    || /could not find the function.*get_my_profile/i.test(error.message);
}

function canTryDirectOwnProfile(error: PostgrestError | null) {
  if (!error) return false;
  return isMissingProfileRpc(error)
    || error.code === '42501'
    || /permission denied|authentication required|not found|schema cache/i.test(error.message);
}

/**
 * Prefer the private profile RPC, but remain compatible with databases that
 * have not received the profile-privacy migration yet.
 */
export async function fetchOwnProfile(userId: string, signal?: AbortSignal): Promise<Profile | null> {
  const profileRequest = supabase.rpc('get_my_profile');
  const rpcResult = signal
    ? await profileRequest.abortSignal(signal)
    : await profileRequest;
  if (!rpcResult.error) return rpcResult.data as Profile | null;
  if (!canTryDirectOwnProfile(rpcResult.error)) throw rpcResult.error;

  const directRequest = supabase
    .from('profiles')
    .select('*')
    .eq('id', userId);
  const { data, error } = signal
    ? await directRequest.abortSignal(signal).maybeSingle()
    : await directRequest.maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}
