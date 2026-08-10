import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from './types';

function isMissingProfileRpc(error: PostgrestError | null) {
  if (!error) return false;
  return error.code === 'PGRST202'
    || /could not find the function.*get_my_profile/i.test(error.message);
}

/**
 * Prefer the private profile RPC, but remain compatible with databases that
 * have not received the profile-privacy migration yet.
 */
export async function fetchOwnProfile(userId: string): Promise<Profile | null> {
  const rpcResult = await supabase.rpc('get_my_profile');
  if (!rpcResult.error) return rpcResult.data as Profile | null;
  if (!isMissingProfileRpc(rpcResult.error)) throw rpcResult.error;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}
