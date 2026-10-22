import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
  advanceMachineJourney,
  answerJourneyQuestion,
  chooseJourneyPenalty,
  createJourneyRuntime,
  expireJourneyQuestion,
  publicJourneyRuntime,
  serveJourneySentence,
  machineJourneyMayAct,
  rollJourneyDie,
  applyJourneyRelic,
  type JourneyQuestion,
  type JourneyRuntime,
} from '../_shared/biblicalJourneyRuntime.ts';
import { JOURNEY_MACHINE_ID } from '../_shared/biblicalJourney.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim() || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || '';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, apikey',
  'X-Full-Circle-Journey-Release': '210',
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function serviceHeaders(prefer?: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders(), ...(init.headers || {}) },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (/You do not own this relic|Relics are available only|match advanced/.test(error.message || '')) throw new Error(error.message);
    throw new Error(`Journey database request failed (${response.status}).`);
  }
  const value = await response.text();
  return value ? JSON.parse(value) : null;
}

async function authenticatedUserId(request: Request): Promise<string> {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('Sign in to play the Biblical Journey.');
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: authorization },
  });
  if (!response.ok) throw new Error('Your session expired. Sign in again.');
  const user = await response.json();
  if (!uuidPattern.test(String(user?.id || ''))) throw new Error('Signed-in player not found.');
  return String(user.id);
}

function characterFromName(roomName: string): string {
  const matches = [...roomName.matchAll(/\[character:([a-z0-9-]{2,40})\]/gi)];
  return matches[matches.length - 1]?.[1]?.toLowerCase() || '';
}

function machineAccuracy(roomName: string): number {
  if (/\[difficulty:easy\]/i.test(roomName)) return 0.55;
  if (/\[difficulty:hard\]/i.test(roomName)) return 0.9;
  return 0.72;
}

async function roomContext(roomId: string) {
  const rooms = await rest(`arena_rooms?id=eq.${roomId}&select=id,room_name,status,play_mode,creator_id`);
  const room = rooms?.[0];
  if (!room || !/\[arena:journey\]/i.test(String(room.room_name || ''))) {
    throw new Error('Biblical Journey room not found.');
  }
  const characterSlug = characterFromName(String(room.room_name));
  if (!characterSlug) throw new Error('This Journey room has no character setting.');
  return { room, characterSlug };
}

async function participants(roomId: string) {
  return await rest(`arena_participants?room_id=eq.${roomId}&select=user_id,forfeited_at,joined_at&order=joined_at.asc`) as
    Array<{ user_id: string; forfeited_at: string | null; joined_at: string }>;
}

async function gameRow(roomId: string, select = 'version,state') {
  const rows = await rest(`arena_journey_games?room_id=eq.${roomId}&select=${select}`);
  return rows?.[0] || null;
}

async function approvedQuestion(id: string): Promise<JourneyQuestion | null> {
  if (!uuidPattern.test(id)) return null;
  // A match keeps its selected question pool even if the instructor later retires one.
  const rows = await rest(`arena_journey_questions?id=eq.${id}&review_status=eq.approved&select=id,question_stage,question_type,question_text,options,correct_answer,accepted_answers,source_reference,explanation`);
  const row = rows?.[0];
  if (!row) return null;
  return {
    id: String(row.id), stage: Number(row.question_stage), type: row.question_type,
    question: String(row.question_text), options: Array.isArray(row.options) ? row.options.map(String) : [],
    correctAnswer: String(row.correct_answer),
    acceptedAnswers: Array.isArray(row.accepted_answers) ? row.accepted_answers.map(String) : [],
    reference: row.source_reference || null, explanation: row.explanation || null,
  };
}

function secureRandom() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] / 4294967296;
}

async function initialRuntime(roomId: string, characterSlug: string, playerIds: string[]) {
  const characters = await rest(`arena_journey_characters?slug=eq.${characterSlug}&ready=eq.true&select=slug`);
  if (!characters?.length) throw new Error('That Biblical Journey character is not ready to play.');
  const rows = await rest('rpc/get_arena_journey_active_question_pool', {
    method: 'POST', body: JSON.stringify({ p_slug: characterSlug }),
  });
  const questions = (rows || []).map((row: { id: string; question_stage: number }) => ({
    id: String(row.id), stage: Number(row.question_stage),
  }));
  return await createJourneyRuntime(characterSlug, playerIds, questions, approvedQuestion, secureRandom);
}

async function pendingViewerChallenge(roomId: string, playerId: string) {
  const rows = await rest(`arena_chat_game_calls?source_room_id=eq.${roomId}&challenged_user_id=eq.${playerId}&response_status=eq.pending&select=id&limit=1`);
  return Boolean(rows?.length);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!supabaseUrl || !serviceKey) return json({ error: 'Journey server configuration is incomplete.' }, 503);

  try {
    const body = await request.json();
    const roomId = String(body?.roomId || '');
    const action = String(body?.action || 'GET').toUpperCase();
    if (action === 'CATALOG') {
      // Public narrative metadata only. Pending questions and answer keys stay private.
      const rows = await rest('arena_journey_characters?select=slug,display_name,ready&order=display_name.asc');
      return json({ characters: (rows || []).map((row: { slug: string; display_name: string; ready: boolean }) => ({
        slug: row.slug, displayName: row.display_name, ready: row.ready === true,
      })) });
    }
    if (!uuidPattern.test(roomId)) return json({ error: 'Invalid Arena room.' }, 400);
    if (!['GET', 'INIT', 'ROLL', 'ANSWER', 'EXPIRE', 'CHOOSE', 'SERVE', 'BOT', 'RELIC'].includes(action)) {
      return json({ error: 'Unknown Journey action.' }, 400);
    }
    const context = await roomContext(roomId);
    if (action === 'GET') {
      if (!['playing', 'completed'].includes(context.room.status)) return json({ error: 'That match is no longer live.' }, 410);
      const versionRow = await gameRow(roomId, 'version');
      if (!versionRow) return context.room.status === 'playing'
        ? json({ state: null, needsInitialization: true }) : json({ error: 'That match is no longer live.' }, 410);
      if (body.knownVersion != null && Number(body.knownVersion) === Number(versionRow.version)) {
        return json({ unchanged: true, version: versionRow.version });
      }
      const snapshot = await gameRow(roomId);
      if (context.room.status === 'completed' && snapshot.state?.game?.status !== 'finished') {
        return json({ error: 'That match is no longer live.' }, 410);
      }
      return json({ state: publicJourneyRuntime(snapshot.state as JourneyRuntime), version: snapshot.version });
    }

    const actorId = await authenticatedUserId(request);
    const playerRows = await participants(roomId);
    const activePlayers = playerRows.filter((player) => !player.forfeited_at);
    if (!activePlayers.some((player) => player.user_id === actorId)) {
      return json({ error: 'Only an active player may advance this match.' }, 403);
    }
    if (action === 'INIT') {
      if (context.room.status !== 'playing') return json({ error: 'That match is no longer live.' }, 410);
      const existing = await gameRow(roomId);
      if (existing) return json({ state: publicJourneyRuntime(existing.state as JourneyRuntime), version: existing.version });
      const machine = context.room.play_mode === 'machine';
      if (machine ? activePlayers.length !== 1 : activePlayers.length < 2 || activePlayers.length > 4) {
        return json({ error: 'This Journey room has the wrong number of players.' }, 409);
      }
      const prepared = await initialRuntime(roomId, context.characterSlug,
        [...activePlayers.map((player) => player.user_id), ...(machine ? [JOURNEY_MACHINE_ID] : [])]);
      // Older cached clients still draw 51 squares until they receive the new app.
      if (body.boardSpaces !== 45) {
        prepared.game.boardSpaces = 51;
        prepared.game.winningLaps = 3;
      }
      const state = await rest(machine ? 'rpc/initialize_machine_arena_journey_game' : 'rpc/initialize_arena_journey_game', {
        method: 'POST', body: JSON.stringify({
          p_room_id: roomId, p_character_slug: context.characterSlug, p_state: prepared,
        }),
      }) as JourneyRuntime;
      return json({ state: publicJourneyRuntime(state), version: state.game.version });
    }

    const commandId = String(body.commandId || '');
    if (!uuidPattern.test(commandId)) return json({ error: 'A command ID is required for reliable retry.' }, 400);
    const current = await gameRow(roomId);
    if (!current) return json({ error: 'This Journey match has not started.' }, 409);
    const repeated = await rest(`arena_journey_commands?room_id=eq.${roomId}&command_id=eq.${commandId}&select=command_id&limit=1`);
    if (repeated?.length) {
      return json({ state: publicJourneyRuntime(current.state as JourneyRuntime), version: current.version, duplicate: true });
    }
    if (context.room.status !== 'playing') return json({ error: 'That match is no longer live.' }, 410);
    if (Number(body.expectedVersion) !== Number(current.version)) {
      return json({ error: 'The board changed on another device.',
        state: publicJourneyRuntime(current.state as JourneyRuntime), version: current.version }, 409);
    }
    if (action !== 'BOT' && action !== 'EXPIRE' && await pendingViewerChallenge(roomId, actorId)) {
      return json({ error: 'Respond to the Arena challenge before playing your next move.' }, 409);
    }

    const previous = current.state as JourneyRuntime;
    let next: JourneyRuntime;
    if (action === 'RELIC') {
      next = await applyJourneyRelic(previous, actorId, String(body.slug || ''), approvedQuestion, secureRandom);
    } else if (action === 'BOT') {
      if (context.room.play_mode !== 'machine' || !machineJourneyMayAct(previous)) {
        return json({ error: 'It is not The Scribe\'s turn.' }, 409);
      }
      next = await advanceMachineJourney(previous, approvedQuestion, secureRandom,
        machineAccuracy(String(context.room.room_name)));
    } else if (action === 'ROLL') {
      next = rollJourneyDie(previous, actorId, secureRandom);
    } else if (action === 'ANSWER') {
      const answer = String(body.answer || '').slice(0, 2000);
      next = await answerJourneyQuestion(previous, actorId, answer, approvedQuestion, secureRandom);
    } else if (action === 'EXPIRE') {
      next = await expireJourneyQuestion(previous, approvedQuestion, secureRandom);
    } else if (action === 'CHOOSE') {
      if (body.choice !== 0 && body.choice !== 1) return json({ error: 'Choose a valid outcome.' }, 400);
      next = await chooseJourneyPenalty(previous, actorId, body.choice, approvedQuestion, secureRandom);
    } else {
      next = await serveJourneySentence(previous, actorId, approvedQuestion, secureRandom);
    }
    const result = await rest('rpc/commit_arena_journey_turn', {
      method: 'POST', body: JSON.stringify({
        p_room_id: roomId, p_expected_version: current.version,
        p_next_state: next, p_command_id: commandId, p_actor_id: actorId,
        p_relic_slug: action === 'RELIC' ? String(body.slug || '') : null,
      }),
    }) as { duplicate: boolean; state: JourneyRuntime };
    return json({ state: publicJourneyRuntime(result.state), version: result.state.game.version,
      duplicate: result.duplicate });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Journey server could not complete that action.';
    const known = /relic|Eliminate needs|wrong choices|reference to reveal|not open for you|not this player's turn|not your turn to roll|Wait for the question|must serve|opposing player|No approved|not ready|match advanced|session expired|Sign in|question is not open|room not found|Scribe's turn|not timed out|before time runs out/i.test(message);
    if (!known) console.error('Biblical Journey action failed:', error);
    return json({ error: known ? message : 'The Journey could not advance. Try again.' }, known ? 409 : 500);
  }
});
