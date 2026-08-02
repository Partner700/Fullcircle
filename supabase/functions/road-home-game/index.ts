import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  applyRoadHomeCommand,
  createRoadHomeGame,
  forfeitRoadHomePlayer,
  normalizeQuestions,
  publicRoadHomeState,
  runRoadHomeBots,
  type RoadHomeCommand,
  type RoadHomeEvent,
  type RoadHomeParticipant,
  type RoadHomeState,
} from "../_shared/road-home-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function serviceHeaders(prefer?: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders(), ...(init.headers || {}) },
  });
  if (!response.ok) throw new Error(await response.text());
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function authenticatedUserId(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("Sign in to play The Road Home.");
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: authorization },
  });
  if (!response.ok) throw new Error("Your session expired. Sign in again.");
  const user = await response.json();
  if (!user?.id) throw new Error("Signed-in player not found.");
  return String(user.id);
}

async function roomContext(roomId: string) {
  const rooms = await rest(`arena_rooms?id=eq.${roomId}&select=id,creator_id,room_name,status,play_mode,stake_amount,question_set`);
  const room = rooms?.[0];
  if (!room) throw new Error("Arena room not found.");
  if (!/\[arena:ludo\]/i.test(room.room_name || "")) throw new Error("This room is not a Road Home match.");
  const participantRows = await rest(`arena_participants?room_id=eq.${roomId}&select=user_id,joined_at,forfeited_at&order=joined_at.asc`);
  const ids = (participantRows || []).map((item: { user_id: string }) => item.user_id);
  const profiles = ids.length
    ? await rest(`profiles?id=in.(${ids.join(",")})&select=id,display_name,avatar_url`)
    : [];
  const byId = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
  const participants: RoadHomeParticipant[] = (participantRows || []).filter((item: any) => !item.forfeited_at).map((item: any) => ({
    id: item.user_id,
    name: byId.get(item.user_id)?.display_name || "Cadet",
    avatarUrl: byId.get(item.user_id)?.avatar_url || null,
  }));
  if (room.play_mode === "machine") participants.push({ id: "machine", name: "The Scribe", isBot: true });
  return {
    room,
    participants,
    participantIds: ids,
    forfeitedIds: (participantRows || []).filter((item: any) => item.forfeited_at).map((item: any) => item.user_id),
    questions: Array.isArray(room.question_set) ? room.question_set : [],
  };
}

async function privateGame(roomId: string) {
  const rows = await rest(`arena_ludo_games?room_id=eq.${roomId}&select=version,private_state`);
  return rows?.[0] || null;
}

async function publicGame(roomId: string) {
  const rows = await rest(`arena_ludo_public_states?room_id=eq.${roomId}&select=version,public_state,updated_at`);
  return rows?.[0] || null;
}

async function commandExists(roomId: string, commandId: string) {
  const rows = await rest(`arena_ludo_commands?room_id=eq.${roomId}&command_id=eq.${commandId}&select=command_id&limit=1`);
  return Boolean(rows?.length);
}

async function replenishQuestionPool(state: RoadHomeState, roomName: string) {
  const remaining = state.questionPool.filter((question) => !state.usedQuestionIds.includes(question.id)).length;
  const openAiKey = Deno.env.get("OPENAI_API_KEY")?.trim() || "";
  if (remaining > 20 || !openAiKey) return state;

  const existingPrompts = state.questionPool.map((question) => question.prompt.trim().toLowerCase());
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a careful Bible scholar and competitive game designer. Return strict JSON only." },
        { role: "user", content: `Create 60 new, difficult but fair Bible questions for Full Circle: The Road Home. Match context: ${roomName}. Use multiple_choice, true_false, or standard_text. Multiple-choice questions need four plausible options and one exact correct_answer. Questions must require memory, reasoning, attention to detail, and Scripture knowledge. Do not repeat or paraphrase any question in this existing list: ${existingPrompts.slice(-160).join(" | ")}. Return {"questions":[{"type":"multiple_choice","question":"...","options":["..."],"correct_answer":"...","reference":"...","explanation":"...","difficulty_tag":"hard"}]}.` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.65,
    }),
  });
  if (!response.ok) return state;
  const data = await response.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  const existing = new Set(existingPrompts);
  const fresh = normalizeQuestions(Array.isArray(parsed.questions) ? parsed.questions : [])
    .filter((question) => !existing.has(question.prompt.trim().toLowerCase()));
  if (fresh.length) state.questionPool.push(...fresh);
  return state;
}

async function insertEvents(roomId: string, previousIds: Set<string>, events: RoadHomeEvent[]) {
  const fresh = events.filter((event) => !previousIds.has(event.id));
  if (!fresh.length) return;
  await rest("arena_ludo_events", {
    method: "POST",
    headers: serviceHeaders("resolution=ignore-duplicates"),
    body: JSON.stringify(fresh.map((event) => ({
      id: event.id,
      room_id: roomId,
      event_type: event.type,
      actor_id: event.playerId || null,
      message: event.message,
      event_data: {},
      created_at: event.createdAt,
    }))),
  });
}

async function createGame(roomId: string, state: RoadHomeState) {
  const publicState = publicRoadHomeState(state);
  await rest("arena_ludo_games", {
    method: "POST",
    headers: serviceHeaders("resolution=merge-duplicates"),
    body: JSON.stringify({ room_id: roomId, version: state.version, private_state: state, updated_at: new Date().toISOString() }),
  });
  await rest("arena_ludo_public_states", {
    method: "POST",
    headers: serviceHeaders("resolution=merge-duplicates"),
    body: JSON.stringify({ room_id: roomId, version: state.version, public_state: publicState, updated_at: new Date().toISOString() }),
  });
  await insertEvents(roomId, new Set(), state.eventLog);
  return publicState;
}

async function saveGame(roomId: string, previous: RoadHomeState, next: RoadHomeState, commandId: string, actorId: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/arena_ludo_games?room_id=eq.${roomId}&version=eq.${previous.version}`, {
    method: "PATCH",
    headers: serviceHeaders("return=representation"),
    body: JSON.stringify({ version: next.version, private_state: next, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(await response.text());
  const rows = await response.json();
  if (!rows.length) throw new Error("The match advanced on another device. Refreshing the board.");

  const publicState = publicRoadHomeState(next);
  await rest("arena_ludo_public_states", {
    method: "POST",
    headers: serviceHeaders("resolution=merge-duplicates"),
    body: JSON.stringify({ room_id: roomId, version: next.version, public_state: publicState, updated_at: new Date().toISOString() }),
  });
  await rest("arena_ludo_commands", {
    method: "POST",
    headers: serviceHeaders("resolution=ignore-duplicates"),
    body: JSON.stringify({ room_id: roomId, command_id: commandId, actor_id: actorId, state_version: next.version }),
  });
  await insertEvents(roomId, new Set(previous.eventLog.map((event) => event.id)), next.eventLog);
  return publicState;
}

async function finishArenaRoom(room: any, state: RoadHomeState) {
  if (state.phase !== "GAME_OVER" || room.status === "completed") return;
  const realPlayers = state.players.filter((player) => !player.isBot);
  for (const player of realPlayers) {
    await rest(`arena_participants?room_id=eq.${room.id}&user_id=eq.${player.id}`, {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ score: player.stats.totalMovement + player.stats.correct, correct_count: player.stats.correct, finished_at: new Date().toISOString() }),
    });
  }
  const winner = state.players.find((player) => player.id === state.winnerId);
  const realWinnerId = winner && !winner.isBot ? winner.id : null;
  const reward = Number(room.stake_amount || 0) * realPlayers.length * 10;
  if (realWinnerId && reward > 0) {
    const existing = await rest(`denarii_ledger_entries?user_id=eq.${realWinnerId}&source_type=eq.arena_reward&source_reference=eq.${room.id}&description=like.Road%20Home%25&select=id&limit=1`);
    if (!existing?.length) {
      await rest("denarii_ledger_entries", {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({ user_id: realWinnerId, amount: reward, source_type: "arena_reward", source_reference: room.id, description: `Road Home tenfold winner reward for ${room.room_name}` }),
      });
    }
  }
  await rest(`arena_rooms?id=eq.${room.id}`, {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({
      status: "completed",
      winner_id: realWinnerId,
      completed_at: new Date().toISOString(),
      completion_reason: state.eventLog.some((event) => event.type === "PLAYER_FORFEITED") ? "forfeit" : "finished",
    }),
  });
}

async function synchronizeForfeits(context: any, existingPrivate: any) {
  const previous = existingPrivate.private_state as RoadHomeState;
  let next = previous;
  for (const playerId of context.forfeitedIds || []) {
    const player = next.players.find((candidate) => candidate.id === playerId);
    if (player && !player.forfeited) next = forfeitRoadHomePlayer(next, playerId);
  }
  if (next.version === previous.version) return publicRoadHomeState(previous);
  try {
    const publicState = await saveGame(context.room.id, previous, next, crypto.randomUUID(), context.forfeitedIds[0] || context.room.creator_id);
    await finishArenaRoom(context.room, next);
    return publicState;
  } catch {
    const latest = await publicGame(context.room.id);
    return latest?.public_state || publicRoadHomeState(next);
  }
}

function secureRandom() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 4294967296;
}

function machineDifficulty(roomName: string): 'easy' | 'medium' | 'hard' {
  const match = roomName.match(/\[difficulty:(easy|medium|hard)\]/i);
  return (match?.[1]?.toLowerCase() as 'easy' | 'medium' | 'hard') || 'medium';
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!supabaseUrl || !serviceKey) return json({ error: "Road Home server configuration is incomplete." }, 503);

  try {
    const actorId = await authenticatedUserId(request);
    const body = await request.json();
    const roomId = String(body.roomId || "");
    const action = String(body.action || "GET").toUpperCase();
    const commandId = String(body.commandId || crypto.randomUUID());
    if (!roomId) return json({ error: "roomId is required." }, 400);

    const context = await roomContext(roomId);
    if (!context.participantIds.includes(actorId)) return json({ error: "You are not a participant in this room." }, 403);

    if (action === "GET") {
      const existingPrivate = await privateGame(roomId);
      if (!existingPrivate) return json({ state: null, needsInitialization: context.room.status === "playing" });
      const state = await synchronizeForfeits(context, existingPrivate);
      return json({ state, version: state.version });
    }

    if (action === "INIT") {
      if (context.room.status !== "playing") return json({ error: "Start the room before beginning The Road Home." }, 409);
      const existing = await publicGame(roomId);
      if (existing) return json({ state: existing.public_state, version: existing.version });
      let state = createRoadHomeGame(roomId, context.participants, context.questions, secureRandom);
      state = runRoadHomeBots(state, context.questions, secureRandom, machineDifficulty(String(context.room.room_name || '')));
      const publicState = await createGame(roomId, state);
      return json({ state: publicState, version: state.version });
    }

    const existingPrivate = await privateGame(roomId);
    if (!existingPrivate) return json({ error: "The Road Home state has not been initialised.", needsInitialization: true }, 409);
    if (await commandExists(roomId, commandId)) {
      const existingPublic = await publicGame(roomId);
      return json({ state: existingPublic?.public_state || publicRoadHomeState(existingPrivate.private_state), version: existingPrivate.version, duplicate: true });
    }
    if (body.expectedVersion != null && Number(body.expectedVersion) !== Number(existingPrivate.version)) {
      const latest = await publicGame(roomId);
      return json({ error: "The board changed on another device.", state: latest?.public_state, version: latest?.version }, 409);
    }

    const previous = existingPrivate.private_state as RoadHomeState;
    if (context.forfeitedIds.includes(actorId) && action !== "FORFEIT") return json({ error: "You have forfeited this match." }, 409);
    if (action === "FORFEIT") {
      await rest(`arena_participants?room_id=eq.${roomId}&user_id=eq.${actorId}`, {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ forfeited_at: new Date().toISOString(), forfeit_reason: "manual", finished_at: new Date().toISOString() }),
      });
    }
    const command = { action, ...(body.payload || {}) } as RoadHomeCommand;
    let commandState = structuredClone(previous) as RoadHomeState;
    if (action === "ROLL") {
      try { commandState = await replenishQuestionPool(commandState, String(context.room.room_name || "Bible Arena")); } catch { /* Keep the verified current deck if expansion is temporarily unavailable. */ }
    }
    const questionPool = commandState.questionPool?.length ? commandState.questionPool : context.questions;
    let next = applyRoadHomeCommand(commandState, actorId, command, questionPool, secureRandom);
    next = runRoadHomeBots(next, questionPool, secureRandom, machineDifficulty(String(context.room.room_name || '')));
    const publicState = await saveGame(roomId, previous, next, commandId, actorId);
    await finishArenaRoom(context.room, next);
    return json({ state: publicState, version: next.version });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Road Home command failed.";
    const status = message.includes("turn") || message.includes("phase") || message.includes("advanced") ? 409 : 400;
    return json({ error: message }, status);
  }
});
