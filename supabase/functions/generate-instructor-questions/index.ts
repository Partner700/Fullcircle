import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, apikey",
};

type Narrative = {
  narrative_date: string;
  title: string;
  theme: string;
  scripture_reference: string;
  main_text: string;
  key_verse_reference?: string | null;
  key_verse_text?: string | null;
};

type GeneratedQuestion = {
  type: "multiple_choice" | "true_false" | "standard_text" | "comprehension";
  question: string;
  options?: string[];
  correct_answer: string;
  explanation: string;
  reference: string;
  game_round?: number;
  difficulty_tag?: "easy" | "moderate" | "hard";
  passage?: string;
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
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function authenticateInstructor(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  const userResponse = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
    headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: authorization },
  });
  if (!userResponse.ok) throw new Error("Invalid user token.");
  const user = await userResponse.json();
  const roleResponse = await fetch(
    `${env("SUPABASE_URL")}/rest/v1/role_assignments?user_id=eq.${encodeURIComponent(user.id)}&role=eq.instructor&status=in.(active,approved)&select=id&limit=1`,
    { headers: serviceHeaders() },
  );
  const roles = roleResponse.ok ? await roleResponse.json() : [];
  if (!roles.length) throw new Error("Only an active instructor can generate platform questions.");
}

async function fetchNarratives(dates: string[]): Promise<Narrative[]> {
  const normalized = Array.from(new Set(dates.map((date) => String(date).trim()).filter(Boolean))).slice(0, 8);
  if (!normalized.length) return [];
  const filter = normalized.map((date) => `"${date.replaceAll('"', '')}"`).join(",");
  const response = await fetch(
    `${env("SUPABASE_URL")}/rest/v1/daily_narratives?narrative_date=in.(${encodeURIComponent(filter)})&select=narrative_date,title,theme,scripture_reference,main_text,key_verse_reference,key_verse_text&order=narrative_date.asc`,
    { headers: serviceHeaders() },
  );
  if (!response.ok) throw new Error("Narrative scripture could not be loaded.");
  return await response.json();
}

function normalizePrompt(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isNearDuplicate(prompt: string, existing: string[]) {
  const tokens = new Set(normalizePrompt(prompt).split(/\s+/).filter((token) => token.length > 2));
  if (!tokens.size) return true;
  return existing.some((candidate) => {
    const other = new Set(normalizePrompt(candidate).split(/\s+/).filter((token) => token.length > 2));
    const intersection = [...tokens].filter((token) => other.has(token)).length;
    const union = new Set([...tokens, ...other]).size;
    return union > 0 && intersection / union >= 0.78;
  });
}

function cleanQuestion(raw: unknown, index: number, mode: "quiz" | "game"): GeneratedQuestion | null {
  const input = raw as Partial<GeneratedQuestion>;
  const question = String(input?.question || "").trim();
  const answer = String(input?.correct_answer || "").trim();
  const explanation = String(input?.explanation || "").trim();
  const reference = String(input?.reference || "").trim();
  if (question.length < 12 || !answer || explanation.length < 12 || !reference) return null;
  const allowed = new Set(["multiple_choice", "true_false", "standard_text", "comprehension"]);
  let type = allowed.has(String(input.type)) ? input.type as GeneratedQuestion["type"] : "multiple_choice";
  if (mode === "quiz" && type === "comprehension") type = "multiple_choice";
  let options: string[] | undefined;
  if (type === "multiple_choice" || type === "comprehension") {
    options = Array.from(new Set((input.options || []).map((option) => String(option).trim()).filter(Boolean))).slice(0, 4);
    if (options.length !== 4 || !options.some((option) => option.toLowerCase() === answer.toLowerCase())) return null;
  } else if (type === "true_false") {
    if (!/^(true|false)$/i.test(answer)) return null;
    options = ["True", "False"];
  }
  const round = mode === "game" ? Math.min(3, Math.floor(index / 5) + 1) : undefined;
  return {
    type,
    question,
    options,
    correct_answer: /^(true|false)$/i.test(answer) ? `${answer[0].toUpperCase()}${answer.slice(1).toLowerCase()}` : answer,
    explanation,
    reference,
    game_round: round,
    difficulty_tag: round === 1 ? "easy" : round === 2 ? "moderate" : round === 3 ? "hard" : input.difficulty_tag || "moderate",
    passage: input.passage ? String(input.passage).trim() : undefined,
  };
}

async function generate(openAiKey: string, prompt: string, count: number) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env("OPENAI_MODEL") || "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.35,
      max_tokens: 10000,
      messages: [
        { role: "system", content: "You are a meticulous Bible scholar, teacher, and assessment designer. Ground every claim in the supplied scripture. Return strict JSON only." },
        { role: "user", content: `${prompt}\nReturn exactly ${count} items as {"questions":[...]}.` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`AI generation failed (${response.status}).`);
  const result = await response.json();
  const parsed = JSON.parse(result.choices?.[0]?.message?.content || "{}");
  return Array.isArray(parsed.questions) ? parsed.questions : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    await authenticateInstructor(req);
    const openAiKey = env("OPENAI_API_KEY");
    if (!openAiKey) return json({ error: "OPENAI_API_KEY is not configured." }, 503);
    const body = await req.json();
    const mode = body.mode === "game" ? "game" : "quiz";
    const count = Math.min(mode === "game" ? 15 : 20, Math.max(5, Number(body.count) || (mode === "game" ? 15 : 10)));
    const narratives = await fetchNarratives(Array.isArray(body.narrativeDates) ? body.narrativeDates : []);
    if (!narratives.length) return json({ error: "No published narrative scripture was found for those dates." }, 400);
    const source = narratives.map((item) => [
      `DATE: ${item.narrative_date}`,
      `TITLE: ${item.title}`,
      `THEME: ${item.theme}`,
      `REFERENCE: ${item.scripture_reference}`,
      `KEY VERSE: ${item.key_verse_reference || ""} ${item.key_verse_text || ""}`,
      `SCRIPTURE TEXT: ${String(item.main_text || "").slice(0, 12000)}`,
    ].join("\n")).join("\n\n---\n\n");
    const gameRules = mode === "game"
      ? `This is Daily Game level ${Number(body.level) || 1}. Create three rounds of five questions. Round 1 is easy, round 2 moderate, round 3 hard. Follow these requested round types when practical: ${JSON.stringify(body.questionTypes || {})}. For comprehension, use the supplied passage for that round and ask a question about it: ${JSON.stringify(body.passages || {})}.`
      : "Create a balanced quiz spanning the supplied week. Increase difficulty gradually and use multiple-choice, true/false, and concise exact written answers.";
    const prompt = `${gameRules}

Requirements:
- Every question must be complete, natural, unambiguous, biblically accurate, and answerable from the supplied text or an explicitly cited cross-reference.
- Test close reading, chronology, motive, consequence, comparison, memory, inference, and attention to detail. Do not use superficial day/date wording.
- Never repeat or paraphrase another question.
- Multiple-choice and comprehension questions need exactly four distinct plausible options. Distractors must resemble the right answer without becoming defensible alternatives.
- Include correct_answer, a concise teaching explanation, and a precise scripture reference.
- Never output planning notes, generation instructions, placeholders, or invented facts.

SOURCE MATERIAL:
${source}`;

    const seen = new Set<string>();
    const questions: GeneratedQuestion[] = [];
    for (let attempt = 0; questions.length < count && attempt < 3; attempt += 1) {
      const raw = await generate(openAiKey, `${prompt}\nAlready used prompts: ${questions.map((item) => item.question).join(" | ") || "none"}`, count - questions.length);
      for (const item of raw) {
        const cleaned = cleanQuestion(item, questions.length, mode);
        if (!cleaned) continue;
        const key = normalizePrompt(cleaned.question);
        if (!key || seen.has(key) || isNearDuplicate(cleaned.question, questions.map((question) => question.question))) continue;
        seen.add(key);
        questions.push(cleaned);
        if (questions.length >= count) break;
      }
    }
    if (questions.length < count) return json({ error: `The generator produced only ${questions.length} valid unique questions. Please retry.` }, 502);
    return json({ questions });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Question generation failed." }, 400);
  }
});
