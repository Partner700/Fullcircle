import { ARENA_STANDSTILL, ARENA_UNDO } from '../_shared/arenaBoardMarket.ts';
import { arenaShieldOwners } from '../_shared/arenaShield.ts';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
  advanceMachineJourney,
  answerJourneyQuestion,
  chooseJourneyPenalty,
  createJourneyRuntime,
  expireJourneyQuestion,
  forfeitJourney,
  finishJourney,
  publicJourneyRuntime,
  serveJourneySentence,
  machineJourneyMayAct,
  rollJourneyDie,
  applyJourneyRelic,
  decideJourneyShield,
  pauseJourneyMatch,
  undoJourneyMove,
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
  'X-Full-Circle-Journey-Release': '215',
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
  const rooms = await rest(`arena_rooms?id=eq.${roomId}&select=id,room_name,status,play_mode,creator_id,started_at`);
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

async function initialRuntime(roomId: string, characterSlug: string, playerIds: string[], roomName: string, startedAt: string) {
  const characters = await rest(`arena_journey_characters?slug=eq.${characterSlug}&ready=eq.true&select=slug`);
  if (!characters?.length) throw new Error('That Biblical Journey character is not ready to play.');
  const rows = await rest('rpc/get_arena_journey_active_question_pool', {
    method: 'POST', body: JSON.stringify({ p_slug: characterSlug }),
  });
  const questions = (rows || []).map((row: { id: string; question_stage: number }) => ({
    id: String(row.id), stage: Number(row.question_stage),
  }));
  let tentSides: Record<string, string> | undefined;
  if (/\[intertent\]/i.test(roomName)) {
    const sides = await rest('rpc/get_intertent_match_sides', {
      method: 'POST', body: JSON.stringify({ p_room_id: roomId }),
    });
    if (!sides || typeof sides !== 'object' || Array.isArray(sides) || playerIds.some(id => !sides[id])) {
      throw new Error('The inter-tent lineup is not ready.');
    }
    tentSides = Object.fromEntries(playerIds.map(id => [id, sides[id]]));
  }
  const runtime = await createJourneyRuntime(characterSlug, playerIds, questions, approvedQuestion, secureRandom, tentSides);
  let seats = playerIds.length;
  if (tentSides) {
    const schedule = await rest(`arena_scheduled_matches?room_id=eq.${roomId}&select=player_ids&limit=1`);
    seats = Math.max(seats, new Set(schedule?.[0]?.player_ids || []).size);
  }
  runtime.game.pointPoolSize = seats * 15;
  runtime.game.pointsRemaining = runtime.game.pointPoolSize;
  runtime.game.matchDeadline = new Date(Date.parse(startedAt) + 45 * 60_000).toISOString();
  return runtime;
}

// A scheduled inter-tent room is allowed to switch to "playing" with one
// attendee. Create its actual board on the first read so witnesses and the
// first participant never stare at a permanent uninitialized shell.
// The existing database initializer enforces room, roster and question safety.
async function ensureInterTentBoard(roomId: string, context: Awaited<ReturnType<typeof roomContext>>) {
  if (context.room.status !== 'playing' || !/\[intertent\]/i.test(String(context.room.room_name))) return null;
  const active = (await participants(roomId)).filter(player => !player.forfeited_at);
  if (active.length < 1 || active.length > 4) return null;
  const machine = context.room.play_mode === 'machine';
  if (machine) return null;
  const prepared = await initialRuntime(roomId, context.characterSlug,
    active.map(player => player.user_id), String(context.room.room_name), context.room.started_at);
  // The current release has a 45-square board; do not fall back to the
  // retired 51-square topology when a witness initializes a scheduled match.
  const stored = await rest('rpc/initialize_arena_journey_game', {
    method: 'POST',
    body: JSON.stringify({
      p_room_id: roomId, p_character_slug: context.characterSlug, p_state: prepared,
    }),
  }) as JourneyRuntime;
  const game = await gameRow(roomId);
  return { state: publicJourneyRuntime(stored), version: game?.version ?? stored.game.version };
}

async function pendingViewerChallenge(roomId: string, playerId: string) {
  const rows = await rest(`arena_chat_game_calls?source_room_id=eq.${roomId}&challenged_user_id=eq.${playerId}&response_status=eq.pending&select=id&limit=1`);
  return Boolean(rows?.length);
}

// Server-owned clock: GET polling can advance an expired turn even if its owner disconnects.
async function advanceExpiredTurn(roomId: string, snapshot: { version: number; state: JourneyRuntime; updated_at: string }) {
  const original = snapshot.state;
  if (original.game.status !== 'playing') return snapshot;
  const closed = Date.now() >= Date.parse(original.game.matchDeadline || '');
  const deadline = original.questionDeadline || (original.awaitingRoll
    ? new Date(Date.parse(snapshot.updated_at) + 45000).toISOString() : null);
  if (!closed && (original.game.shieldOffer || !original.currentQuestionPlayerId || !deadline
    || Date.now() < Date.parse(deadline) || Date.now() < Date.parse(original.pausedUntil || ''))) return snapshot;
  const active = (await participants(roomId)).filter(player => !player.forfeited_at);
  const actor = closed ? active[0]?.user_id : original.currentQuestionPlayerId;
  if (!actor || !active.some(p => p.user_id === actor)) return snapshot;
  let next: JourneyRuntime;
  if (closed) {
    next = structuredClone(original);
    next.game.version++;
    next.game.closedByClock = true;
    finishJourney(next);
  } else {
    const owners = await arenaShieldOwners(rest, active.map(p => p.user_id));
    next = await expireJourneyQuestion({ ...original, questionDeadline: deadline }, approvedQuestion, secureRandom, owners);
    if (next.game.status === 'finished' || next.game.pointsRemaining === 0) finishJourney(next);
  }
  try {
    const result = await rest('rpc/commit_arena_journey_turn', {
      method: 'POST', body: JSON.stringify({
        p_room_id: roomId, p_expected_version: snapshot.version, p_next_state: next,
        p_command_id: crypto.randomUUID(), p_actor_id: actor, p_relic_slug: null,
      }),
    }) as { state: JourneyRuntime };
    return { state: result.state, version: result.state.game.version, updated_at: new Date().toISOString() };
  } catch (error) {
    if (!/match advanced/i.test(String(error))) throw error;
    return await gameRow(roomId, 'version,state,updated_at') || snapshot;
  }
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
    if (!['FORFEIT', 'GET', 'INIT', 'ROLL', 'ANSWER', 'EXPIRE', 'CHOOSE', 'SERVE', 'BOT', 'RELIC', 'SHIELD', 'UNDO', 'STANDSTILL'].includes(action)) {
      return json({ error: 'Unknown Journey action.' }, 400);
    }
    const context = await roomContext(roomId);
    if (action === 'GET') {
      if (!['playing', 'completed'].includes(context.room.status)) return json({ error: 'That match is no longer live.' }, 410);
      const knownVersion = Number(body.knownVersion);
      const hasKnownVersion = body.knownVersion != null
        && Number.isSafeInteger(knownVersion) && knownVersion >= 0;
      // A version-aware read replaces two sequential database requests.
      // When the board hasn't changed, PostgREST returns no state at all.
      const cutoff = new Date(Date.now() - 30000).toISOString();
      const gameRows = await rest(
        `arena_journey_games?room_id=eq.${roomId}&select=version,state,updated_at${hasKnownVersion ? `&or=(version.neq.${knownVersion},updated_at.lte.${cutoff})` : ''}&limit=1`,
      );
      let snapshot = gameRows?.[0];
      if (!snapshot && hasKnownVersion) {
        return json({ unchanged: true, version: knownVersion });
      }
      if (!snapshot) {
        if (context.room.status !== 'playing') return json({ error: 'That match is no longer live.' }, 410);
        const initialized = await ensureInterTentBoard(roomId, context);
        if (initialized) return json(initialized);
        const joined = (await participants(roomId)).filter(player => !player.forfeited_at).length;
        return json({
          state: null, needsInitialization: true,
          waitingForPlayers: joined === 0,
          joinedPlayers: joined,
        });
      }
      if (context.room.status === 'completed' && snapshot.state?.game?.status !== 'finished') {
        return json({ error: 'That match is no longer live.' }, 410);
      }
      if (context.room.status === 'playing') {
        snapshot = await advanceExpiredTurn(roomId, snapshot);
      }
      if (hasKnownVersion && snapshot.version === knownVersion) return json({ unchanged: true, version: knownVersion });
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
      const interTent = /\[intertent\]/i.test(String(context.room.room_name));
      if (machine ? activePlayers.length !== 1
        : activePlayers.length < (interTent ? 1 : 2) || activePlayers.length > 4) {
        return json({ error: 'This Journey room has the wrong number of players.' }, 409);
      }
      const prepared = await initialRuntime(roomId, context.characterSlug,
        [...activePlayers.map((player) => player.user_id), ...(machine ? [JOURNEY_MACHINE_ID] : [])], String(context.room.room_name), context.room.started_at);
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
    let current = await gameRow(roomId, 'version,state,updated_at');
    if (!current) return json({ error: 'This Journey match has not started.' }, 409);
    const repeated = await rest(`arena_journey_commands?room_id=eq.${roomId}&command_id=eq.${commandId}&select=command_id&limit=1`);
    if (repeated?.length) {
      return json({ state: publicJourneyRuntime(current.state as JourneyRuntime), version: current.version, duplicate: true });
    }
    if (context.room.status !== 'playing') return json({ error: 'That match is no longer live.' }, 410);
    current = await advanceExpiredTurn(roomId, current);
    if (Number(body.expectedVersion) !== Number(current.version)) {
      return json({ error: 'The board changed on another device.',
        state: publicJourneyRuntime(current.state as JourneyRuntime), version: current.version }, 409);
    }
    if (action !== 'FORFEIT' && action !== 'BOT' && action !== 'EXPIRE' && action !== 'SHIELD' && await pendingViewerChallenge(roomId, actorId)) {
      return json({ error: 'Respond to the Arena challenge before playing your next move.' }, 409);
    }

    const original = current.state as JourneyRuntime;
    if (original.game.players.find(p => p.id === actorId)?.forfeitedPoints !== undefined) return json({ error: 'You have forfeited this match.' }, 403);
    if (action !== 'FORFEIT' && Date.now() < Date.parse(original.pausedUntil || '')) return json({ error: 'The match is paused by Standstill.' }, 409);
    const previous = { ...original };
    delete previous.pausedUntil;
    const resolvingMachineChoice = context.room.play_mode === 'machine' && action === 'CHOOSE'
      && original.game.pendingAction?.playerId === JOURNEY_MACHINE_ID;
    if (!['UNDO', 'SHIELD', 'STANDSTILL', 'BOT'].includes(action) && !resolvingMachineChoice) delete previous.undo;
    const decision = body.decision;
    if (action === 'SHIELD' && decision !== 'use' && decision !== 'expire' && decision !== 'reflect') return json({ error: 'Choose a valid Shield of Faith action.' }, 400);
    if (previous.game.shieldOffer && action !== 'SHIELD' && action !== 'FORFEIT') return json({ error: 'Wait for the Shield of Faith decision.' }, 409);
    const useShield = action === 'SHIELD' && decision === 'use';
    const useBoomerang = action === 'SHIELD' && decision === 'reflect';
    const shieldOwners = body.shieldDecisionV1 === true && ['ANSWER', 'EXPIRE', 'CHOOSE', 'BOT', 'RELIC', 'SHIELD'].includes(action)
      ? await arenaShieldOwners(rest, activePlayers.map((player) => player.user_id), useShield ? actorId : undefined) : undefined;
    const spend = action === 'UNDO' ? ARENA_UNDO : action === 'STANDSTILL' ? ARENA_STANDSTILL : undefined;
    let next: JourneyRuntime;
    if (action === 'FORFEIT') {
      next = await forfeitJourney(original, actorId, approvedQuestion, secureRandom);
    } else if (action === 'UNDO') {
      next = await undoJourneyMove(previous, actorId, approvedQuestion, secureRandom);
    } else if (action === 'STANDSTILL') {
      next = pauseJourneyMatch(previous, actorId);
    } else if (action === 'SHIELD') {
      next = await decideJourneyShield(previous, actorId, decision, approvedQuestion, secureRandom, shieldOwners);
    } else if (action === 'RELIC') {
      next = await applyJourneyRelic(previous, actorId, String(body.slug || ''), approvedQuestion, secureRandom, shieldOwners);
    } else if (action === 'BOT') {
      if (context.room.play_mode !== 'machine' || !machineJourneyMayAct(previous)) {
        return json({ error: 'It is not The Scribe\'s turn.' }, 409);
      }
      next = await advanceMachineJourney(previous, approvedQuestion, secureRandom,
        machineAccuracy(String(context.room.room_name)), shieldOwners);
    } else if (action === 'ROLL') {
      next = rollJourneyDie(previous, actorId, secureRandom);
    } else if (action === 'ANSWER') {
      const answer = String(body.answer || '').slice(0, 2000);
      next = previous.currentQuestionPlayerId === actorId && Date.now() >= Date.parse(previous.questionDeadline || '')
        ? await expireJourneyQuestion(previous, approvedQuestion, secureRandom, shieldOwners)
        : await answerJourneyQuestion(previous, actorId, answer, approvedQuestion, secureRandom, shieldOwners);
    } else if (action === 'EXPIRE') {
      next = await expireJourneyQuestion(previous, approvedQuestion, secureRandom, shieldOwners);
    } else if (action === 'CHOOSE') {
      if (body.choice !== 0 && body.choice !== 1) return json({ error: 'Choose a valid outcome.' }, 400);
      next = await chooseJourneyPenalty(previous, actorId, body.choice, approvedQuestion, secureRandom, shieldOwners);
    } else {
      next = await serveJourneySentence(previous, actorId, approvedQuestion, secureRandom);
    }
    if (next.game.status === 'finished' || next.game.pointsRemaining === 0) finishJourney(next);
    if (Date.now() >= Date.parse(original.game.matchDeadline || '')) {
      const settled = await advanceExpiredTurn(roomId, current);
      return json({ state: publicJourneyRuntime(settled.state), version: settled.version });
    }
    const result = await rest(spend ? 'rpc/commit_arena_board_market_turn'
      : useShield ? 'rpc/commit_arena_shield_turn' : useBoomerang ? 'rpc/commit_arena_boomerang_turn' : 'rpc/commit_arena_journey_turn', {
      method: 'POST', body: JSON.stringify({
        p_room_id: roomId, p_expected_version: current.version,
        p_next_state: next, p_command_id: commandId, p_actor_id: actorId,
        ...(spend ? { p_spend_slug: spend, p_award_slug: null, p_public_state: null } : (useShield || useBoomerang) ? {} : { p_relic_slug: action === 'RELIC' ? String(body.slug || '') : null }),
      }),
    }) as { duplicate: boolean; state: JourneyRuntime };
    return json({ state: publicJourneyRuntime(result.state), version: result.state.game.version,
      duplicate: result.duplicate });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Journey server could not complete that action.';
    const known = /Shield of Faith|Undo|Standstill|relic|Eliminate needs|wrong choices|reference to reveal|not open for you|not this player's turn|not your turn to roll|Wait for the question|must serve|opposing player|No approved|not ready|match advanced|session expired|Sign in|question is not open|room not found|Scribe's turn|not timed out|before time runs out/i.test(message);
    if (!known) console.error('Biblical Journey action failed:', error);
    return json({ error: known ? message : 'The Journey could not advance. Try again.' }, known ? 409 : 500);
  }
});
