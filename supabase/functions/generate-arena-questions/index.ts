import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, apikey",
};

type ArenaQuestion = {
  type: "multiple_choice" | "true_false" | "standard_text";
  question: string;
  options?: string[];
  correct_answer: string;
  accepted_answers?: string[];
  explanation?: string;
  reference?: string;
  difficulty_tag?: "easy" | "moderate" | "hard";
  game_round?: number;
  round_timer_seconds?: number;
  is_bonus?: boolean;
};

type ArenaContext = {
  id: string;
  room_name: string;
  status: string;
};

function env(name: string) {
  return Deno.env.get(name)?.trim() || "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function serviceHeaders() {
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

async function authenticate(req: Request): Promise<string> {
  const response = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: req.headers.get("Authorization") || "",
    },
  });
  if (!response.ok) throw new Error("Invalid user token.");
  const user = await response.json();
  if (!user?.id) throw new Error("Authenticated user not found.");
  return String(user.id);
}

async function serviceRpc(name: string, args: Record<string, unknown>) {
  const response = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${await response.text()}`);
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

async function fetchArenaContext(roomId: string, userId: string): Promise<ArenaContext> {
  const roomResponse = await fetch(
    `${env("SUPABASE_URL")}/rest/v1/arena_rooms?id=eq.${encodeURIComponent(roomId)}&select=id,room_name,status`,
    { headers: serviceHeaders() },
  );
  if (!roomResponse.ok) throw new Error("Arena room could not be loaded.");
  const room = (await roomResponse.json())?.[0] as ArenaContext | undefined;
  if (!room || !["waiting", "playing"].includes(room.status)) throw new Error("Arena room is not available.");

  const participantResponse = await fetch(
    `${env("SUPABASE_URL")}/rest/v1/arena_participants?room_id=eq.${encodeURIComponent(roomId)}&user_id=eq.${encodeURIComponent(userId)}&forfeited_at=is.null&select=id&limit=1`,
    { headers: serviceHeaders() },
  );
  if (!participantResponse.ok) throw new Error("Arena participation could not be verified.");
  if (!(await participantResponse.json())?.length) {
    throw new Error("Only active room participants can prepare Arena questions.");
  }
  return room;
}

async function fetchRoomQuestions(roomId: string, minimumCount: number) {
  const response = await fetch(
    `${env("SUPABASE_URL")}/rest/v1/arena_rooms?id=eq.${encodeURIComponent(roomId)}&select=question_set`,
    { headers: serviceHeaders() },
  );
  if (!response.ok) return null;
  const existing = (await response.json())?.[0]?.question_set;
  if (!Array.isArray(existing) || existing.length < minimumCount) return null;
  const distinct = new Set(existing.map((item) => questionKey(item)));
  return distinct.size >= minimumCount ? existing : null;
}

async function waitForRoomQuestions(roomId: string, minimumCount: number) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const questions = await fetchRoomQuestions(roomId, minimumCount);
    if (questions) return questions;
  }
  return null;
}

function normalizedText(value: unknown) {
  return String(value ?? "").trim();
}

function questionKey(question: unknown) {
  const item = question as Partial<ArenaQuestion> | null;
  return `${item?.question || ""}|${item?.correct_answer || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function distinctStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.map(normalizedText).filter((item) => {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveOptionAnswer(options: string[], answer: unknown) {
  if (typeof answer === "number" && Number.isInteger(answer)) {
    return options[answer] || options[answer - 1] || "";
  }
  const supplied = normalizedText(answer);
  return options.find((option) => option.toLowerCase() === supplied.toLowerCase()) || "";
}

function normalizeQuizQuestion(raw: unknown): ArenaQuestion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const question = normalizedText(source.question);
  if (!question || (typeof source.correct_answer !== "string" && typeof source.correct_answer !== "number")) return null;

  const sourceType = normalizedText(source.type).toLowerCase();
  const options = distinctStrings(source.options);
  let type: ArenaQuestion["type"] = "standard_text";
  let correctAnswer = normalizedText(source.correct_answer);
  let playableOptions: string[] | undefined;

  if (sourceType === "true_false") {
    type = "true_false";
    playableOptions = ["True", "False"];
    correctAnswer = /^true$/i.test(correctAnswer) ? "True" : /^false$/i.test(correctAnswer) ? "False" : "";
  } else if (options.length >= 2) {
    type = "multiple_choice";
    playableOptions = options;
    correctAnswer = resolveOptionAnswer(options, source.correct_answer);
  }
  if (!correctAnswer) return null;

  const acceptedAnswers = distinctStrings(source.accepted_answers);
  const difficulty = normalizedText(source.difficulty_tag);
  return {
    type,
    question,
    ...(playableOptions ? { options: playableOptions } : {}),
    correct_answer: correctAnswer,
    ...(acceptedAnswers.length ? { accepted_answers: acceptedAnswers } : {}),
    ...(normalizedText(source.explanation) ? { explanation: normalizedText(source.explanation) } : {}),
    ...(normalizedText(source.reference) ? { reference: normalizedText(source.reference) } : {}),
    ...(difficulty === "easy" || difficulty === "moderate" || difficulty === "hard"
      ? { difficulty_tag: difficulty }
      : {}),
  };
}

function seededShuffle<T>(items: T[], seed: string): T[] {
  const output = [...items];
  let value = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 2166136261);
  for (let index = output.length - 1; index > 0; index -= 1) {
    value = (value * 1664525 + 1013904223) >>> 0;
    const swapIndex = value % (index + 1);
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function applyArenaTiming(question: ArenaQuestion, index: number): ArenaQuestion {
  const round = index < 6 ? 1 : index < 12 ? 2 : index < 18 ? 3 : 4;
  return {
    ...question,
    difficulty_tag: round === 1 ? "easy" : round === 2 ? "moderate" : "hard",
    game_round: round,
    round_timer_seconds: round === 1 ? 17 : round === 2 ? 14 : 11,
    is_bonus: index === 18,
  };
}

async function buildQuizArchiveDeck(roomId: string, targetCount: number) {
  const source = await serviceRpc("get_arena_quiz_question_pool", { p_limit: 5000 });
  const seen = new Set<string>();
  const playable = (Array.isArray(source) ? source : [])
    .map(normalizeQuizQuestion)
    .filter((question): question is ArenaQuestion => {
      if (!question) return false;
      const key = questionKey(question);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (playable.length < targetCount) {
    throw new Error(
      `Arena needs ${targetCount} distinct questions from previous Weekly or Fortune quizzes, but ${playable.length} are currently available. Upload and complete more quiz questions first.`,
    );
  }
  return seededShuffle(playable, roomId).slice(0, targetCount).map(applyArenaTiming);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let claimedRoomId = "";
  let claimedUserId = "";
  try {
    const userId = await authenticate(req);
    const body = await req.json();
    const roomId = normalizedText(body.roomId);
    if (!roomId) return json({ error: "roomId is required." }, 400);

    const room = await fetchArenaContext(roomId, userId);
    const targetCount = /\[arena:ludo\]/i.test(room.room_name) ? 120 : 19;
    const existing = await fetchRoomQuestions(roomId, targetCount);
    if (existing) return json({ questions: existing });

    const claimed = Boolean(await serviceRpc("claim_arena_question_generation", {
      p_room_id: roomId,
      p_user_id: userId,
    }));
    if (!claimed) {
      const prepared = await waitForRoomQuestions(roomId, targetCount);
      return prepared
        ? json({ questions: prepared })
        : json({ error: "Another player is preparing this Arena match. Please try again." }, 409);
    }
    claimedRoomId = roomId;
    claimedUserId = userId;

    const questions = await buildQuizArchiveDeck(roomId, targetCount);
    const publicQuestions = await serviceRpc("store_arena_question_deck", {
      p_room_id: roomId,
      p_questions: questions,
    });
    claimedRoomId = "";
    claimedUserId = "";
    return json({ questions: publicQuestions });
  } catch (error) {
    if (claimedRoomId && claimedUserId) {
      try {
        await serviceRpc("release_arena_question_generation", {
          p_room_id: claimedRoomId,
          p_user_id: claimedUserId,
        });
      } catch {
        // The database lease expires even if this cleanup request fails.
      }
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});
