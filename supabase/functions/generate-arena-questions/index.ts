import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, apikey",
};

type QuestionPayload = {
  type: "multiple_choice" | "true_false";
  question: string;
  options?: string[];
  correct_answer: string;
  explanation?: string;
  reference?: string;
  game_round?: number;
  round_timer_seconds?: number;
  is_bonus?: boolean;
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

function cleanQuestion(raw: unknown, index: number): QuestionPayload | null {
  const q = raw as Partial<QuestionPayload>;
  if (!q?.question || !q.correct_answer) return null;
  const type = ["multiple_choice", "true_false"].includes(String(q.type))
    ? q.type as QuestionPayload["type"]
    : "multiple_choice";
  const round = index < 6 ? 1 : index < 12 ? 2 : index < 18 ? 3 : 4;
  const seconds = round === 1 ? 90 : round === 2 ? 72 : round === 3 ? 54 : 10;
  const options = type === "multiple_choice"
    ? Array.from(new Set((q.options || []).map((item) => String(item).trim()).filter(Boolean))).slice(0, 4)
    : type === "true_false" ? ["True", "False"] : undefined;
  if (type === "multiple_choice" && (!options || options.length < 2 || !options.includes(String(q.correct_answer)))) return null;
  return {
    type,
    question: String(q.question).trim(),
    options,
    correct_answer: String(q.correct_answer).trim(),
    explanation: q.explanation ? String(q.explanation).trim() : undefined,
    reference: q.reference ? String(q.reference).trim() : undefined,
    game_round: round,
    round_timer_seconds: seconds,
    is_bonus: index === 18,
  };
}

async function authenticate(req: Request) {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization") || "";
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: authorization },
  });
  if (!res.ok) throw new Error("Invalid user token.");
}

async function fetchRoomQuestions(roomId: string, minimumCount: number) {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${supabaseUrl}/rest/v1/arena_rooms?id=eq.${roomId}&select=question_set`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  const existing = rows?.[0]?.question_set;
  return Array.isArray(existing) && existing.length >= minimumCount ? existing : null;
}

async function saveRoomQuestions(roomId: string, questions: QuestionPayload[]) {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${supabaseUrl}/rest/v1/arena_rooms?id=eq.${roomId}`, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ question_set: questions, question_generated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Could not save the Arena question deck: ${await response.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    await authenticate(req);
    const openAiKey = env("OPENAI_API_KEY");
    if (!openAiKey) return json({ error: "OPENAI_API_KEY is not configured." }, 503);

    const body = await req.json();
    const roomId = String(body.roomId || "");
    if (!roomId) return json({ error: "roomId is required." }, 400);

    const gameType = String(body.gameType || (String(body.roomName || '').includes('[arena:ludo]') ? 'ludo' : 'standard'));
    const targetCount = gameType === 'ludo' ? 120 : 19;
    const existing = await fetchRoomQuestions(roomId, targetCount);
    if (existing) return json({ questions: existing });

    const topicType = String(body.topicType || "narrative");
    const difficulty = ["easy", "medium", "hard"].includes(String(body.difficulty)) ? String(body.difficulty) : "mixed";
    const topic = String(body.topic || "");
    const narrative = body.narrative || {};
    const source = topicType === "book" || topicType === "character"
      ? `${topicType}: ${topic}`
      : `weekly narrative: ${narrative.title || "Untitled"}; theme: ${narrative.theme || ""}; scripture: ${narrative.scripture_reference || ""}; main text: ${narrative.main_text || ""}`;

    const formatRule = gameType === 'ludo'
      ? '- This is a long four-pawn Ludo match. Create one broad, varied question deck with no round grouping.'
      : '- Three rounds of six questions, then one final bonus question.';
    const prompt = `Create exactly ${targetCount} difficult but fair Bible arena questions for Full Circle.
Rules:
${formatRule}
- No repeated questions, no vague trivia, no incomplete wording.
- Use only these types: multiple_choice and true_false. Standard Trivia must always be answerable by tapping a choice, never by typing free text.
- Every multiple_choice question must have 4 options and one exact correct_answer from the options.
- Do not reveal answers inside the question.
- Questions must be intelligible, scholarly, and challenging.
- Requested machine difficulty: ${difficulty}. When it is not mixed, make every question genuinely ${difficulty}.
- Source focus: ${source}
Return only JSON in this shape: {"questions":[{"type":"multiple_choice","question":"...","options":["..."],"correct_answer":"...","explanation":"...","reference":"..."}]}`;

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env("OPENAI_MODEL") || "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a careful Bible scholar and game designer. Return strict JSON only." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.55,
      }),
    });
    if (!aiRes.ok) return json({ error: await aiRes.text() }, 502);

    const aiData = await aiRes.json();
    const parsed = JSON.parse(aiData.choices?.[0]?.message?.content || "{}");
    const seen = new Set<string>();
    const questions = (parsed.questions || [])
      .map((item: unknown, index: number) => cleanQuestion(item, index))
      .filter((item: QuestionPayload | null): item is QuestionPayload => {
        if (!item) return false;
        const key = item.question.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, targetCount);

    if (questions.length < targetCount) return json({ error: "AI returned too few valid unique arena questions." }, 502);
    if (body.persist !== false) await saveRoomQuestions(roomId, questions);
    return json({ questions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});
