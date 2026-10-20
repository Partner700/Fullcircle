import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';
import type { JourneyPublicState } from '../../supabase/functions/_shared/biblicalJourneyRuntime';
import { connectionError, readableFetch, userFacingError } from './connectionErrors';

export type JourneyServerResponse = {
  state: JourneyPublicState | null;
  version?: number;
  unchanged?: boolean;
  needsInitialization?: boolean;
  duplicate?: boolean;
};

export async function fetchJourneyState(roomId: string, knownVersion?: number): Promise<JourneyServerResponse> {
  return callJourneyServer({ roomId, action: 'GET', knownVersion }, false);
}

export async function initializeJourney(roomId: string): Promise<JourneyServerResponse> {
  return callJourneyServer({ roomId, action: 'INIT' }, true);
}

export async function sendJourneyCommand(roomId: string, action: 'ROLL' | 'ANSWER' | 'EXPIRE' | 'CHOOSE' | 'SERVE' | 'BOT',
  expectedVersion: number, commandId: string, payload: Record<string, unknown> = {}): Promise<JourneyServerResponse> {
  return callJourneyServer({ roomId, action, expectedVersion, commandId, ...payload }, true);
}

async function callJourneyServer(body: Record<string, unknown>, requiresSignIn: boolean): Promise<JourneyServerResponse> {
  const token = requiresSignIn ? (await supabase.auth.getSession()).data.session?.access_token : null;
  if (requiresSignIn && !token) throw new Error('Sign in again to continue the Biblical Journey.');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 18_000);
  try {
    const response = await readableFetch(`${supabaseUrl}/functions/v1/biblical-journey`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload: JourneyServerResponse & { error?: string };
    try { payload = raw ? JSON.parse(raw) : { state: null }; }
    catch { throw new Error('Full Circle could not open the match response. Please try again shortly.'); }
    if (!response.ok) {
      const error = new Error(userFacingError(payload.error, 'The Journey could not advance. Please try again.')) as Error & { state?: JourneyPublicState | null; version?: number };
      error.state = payload.state;
      error.version = payload.version;
      throw error;
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted) throw connectionError(error, { timedOut: true });
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
