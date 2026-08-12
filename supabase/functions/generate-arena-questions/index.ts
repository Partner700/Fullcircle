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
  difficulty_tag?: "easy" | "moderate" | "hard";
  game_round?: number;
  round_timer_seconds?: number;
  is_bonus?: boolean;
};

type FallbackFact = {
  reference: string;
  prompt: string;
  answer: string;
  options: string[];
  explanation: string;
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
  const suppliedAnswer = String(q.correct_answer).trim();
  const canonicalAnswer = options?.find((option) => option.toLowerCase() === suppliedAnswer.toLowerCase()) || suppliedAnswer;
  if (type === "multiple_choice" && (!options || options.length !== 4 || !options.includes(canonicalAnswer))) return null;
  return {
    type,
    question: String(q.question).trim(),
    options,
    correct_answer: canonicalAnswer,
    explanation: q.explanation ? String(q.explanation).trim() : undefined,
    reference: q.reference ? String(q.reference).trim() : undefined,
    difficulty_tag: round === 1 ? "easy" : round === 2 ? "moderate" : "hard",
    game_round: round,
    round_timer_seconds: seconds,
    is_bonus: index === 18,
  };
}

function isNearDuplicate(prompt: string, existing: string[]) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const stopwords = new Set([
    "what", "when", "where", "which", "who", "whom", "whose", "why", "how", "did", "does", "was", "were",
    "the", "and", "for", "from", "that", "this", "with", "about", "according", "verse", "passage", "scripture",
    "book", "character", "arena", "question", "answer",
  ]);
  const tokensFor = (value: string) => normalize(value)
    .split(/\s+/)
    .map((token) => token.replace(/(ing|ed|es|s)$/i, ""))
    .filter((token) => token.length > 2 && !stopwords.has(token));
  const signatureFor = (value: string) => Array.from(new Set(tokensFor(value))).sort().slice(0, 12).join(" ");
  const signature = signatureFor(prompt);
  const tokens = new Set(tokensFor(prompt));
  if (!tokens.size) return true;
  return existing.some((candidate) => {
    if (signature && signature === signatureFor(candidate)) return true;
    const other = new Set(tokensFor(candidate));
    const intersection = [...tokens].filter((token) => other.has(token)).length;
    const union = new Set([...tokens, ...other]).size;
    return union > 0 && intersection / union >= 0.52;
  });
}

async function authenticate(req: Request): Promise<string> {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization") || "";
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: authorization },
  });
  if (!res.ok) throw new Error("Invalid user token.");
  const user = await res.json();
  if (!user?.id) throw new Error("Authenticated user not found.");
  return String(user.id);
}

type ArenaContext = {
  id: string;
  room_name: string;
  narrative_date: string | null;
  status: string;
  creator_id: string;
};

function serviceHeaders() {
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
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
  const supabaseUrl = env("SUPABASE_URL");
  const roomResponse = await fetch(
    `${supabaseUrl}/rest/v1/arena_rooms?id=eq.${encodeURIComponent(roomId)}&select=id,room_name,narrative_date,status,creator_id`,
    { headers: serviceHeaders() },
  );
  if (!roomResponse.ok) throw new Error("Arena room could not be loaded.");
  const rooms = await roomResponse.json();
  const room = rooms?.[0] as ArenaContext | undefined;
  if (!room || !["waiting", "playing"].includes(room.status)) throw new Error("Arena room is not available.");

  const participantResponse = await fetch(
    `${supabaseUrl}/rest/v1/arena_participants?room_id=eq.${encodeURIComponent(roomId)}&user_id=eq.${encodeURIComponent(userId)}&forfeited_at=is.null&select=id&limit=1`,
    { headers: serviceHeaders() },
  );
  if (!participantResponse.ok) throw new Error("Arena participation could not be verified.");
  const participants = await participantResponse.json();
  if (!participants?.length) throw new Error("Only active room participants can prepare Arena questions.");
  return room;
}

async function fetchRoomQuestions(roomId: string, minimumCount: number) {
  const supabaseUrl = env("SUPABASE_URL");
  const res = await fetch(`${supabaseUrl}/rest/v1/arena_rooms?id=eq.${encodeURIComponent(roomId)}&select=question_set`, {
    headers: serviceHeaders(),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  const existing = rows?.[0]?.question_set;
  return Array.isArray(existing) && existing.length >= minimumCount ? existing : null;
}

async function waitForRoomQuestions(roomId: string, minimumCount: number) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const questions = await fetchRoomQuestions(roomId, minimumCount);
    if (questions) return questions;
  }
  return null;
}

function parseRoomTopic(roomName: string) {
  const match = roomName.match(/\[(book|character):\s*([^\]]+)\]/i);
  return match ? { type: match[1].toLowerCase(), value: match[2].trim() } : null;
}

function roomDifficulty(roomName: string) {
  const match = roomName.match(/\[difficulty:(easy|medium|hard)\]/i);
  return match?.[1]?.toLowerCase() || "mixed";
}

function packetLevel(difficulty: string) {
  if (difficulty === "easy") return "Level 1 packet: clear narrative memory, direct sequence, visible contrasts, and exact speaker/action details.";
  if (difficulty === "medium") return "Level 2 packet: layered chronology, motives, cause-and-effect, comparisons, and plausible distractors.";
  if (difficulty === "hard") return "Level 3 packet: close-reading traps, cross-scene reasoning, quiet details, and options that strongly resemble the right answer.";
  return "Mixed packet: escalate steadily from direct memory to close-reading reasoning.";
}

const FALLBACK_FACTS: FallbackFact[] = [
  { reference: "Genesis 3", prompt: "After Adam and Eve ate the forbidden fruit, what did they make for themselves?", answer: "Coverings from fig leaves", options: ["Coverings from fig leaves", "A stone altar", "A wooden ark", "A bronze serpent"], explanation: "Genesis says they sewed fig leaves together after their eyes were opened." },
  { reference: "Genesis 4", prompt: "What was Abel's occupation?", answer: "Keeper of sheep", options: ["Keeper of sheep", "Builder of cities", "Cupbearer", "Tax collector"], explanation: "Abel kept sheep while Cain worked the ground." },
  { reference: "Genesis 6", prompt: "What kind of wood was Noah told to use for the ark?", answer: "Gopher wood", options: ["Gopher wood", "Cedar of Lebanon", "Acacia wood", "Olive wood"], explanation: "Genesis 6 names gopher wood in the ark command." },
  { reference: "Genesis 12", prompt: "What land did God call Abram to leave for?", answer: "The land God would show him", options: ["The land God would show him", "Egypt", "Moab", "Babylon"], explanation: "Abram was called to go to the land God would show him." },
  { reference: "Genesis 22", prompt: "On which mountain region was Abraham tested with Isaac?", answer: "Moriah", options: ["Moriah", "Sinai", "Carmel", "Nebo"], explanation: "Genesis 22 places the test in the land of Moriah." },
  { reference: "Genesis 37", prompt: "What did Joseph's brothers dip his robe in?", answer: "Goat's blood", options: ["Goat's blood", "Wine", "Oil", "River water"], explanation: "They dipped Joseph's robe in goat's blood before showing it to Jacob." },
  { reference: "Exodus 3", prompt: "What did Moses see burning without being consumed?", answer: "A bush", options: ["A bush", "A mountain", "A scroll", "A pillar"], explanation: "Moses saw the bush burning, yet it was not consumed." },
  { reference: "Exodus 12", prompt: "What marked Israelite doors during Passover?", answer: "Blood on the doorposts", options: ["Blood on the doorposts", "Gold dust", "A blue cord", "Manna"], explanation: "The Passover sign was blood on the doorposts and lintel." },
  { reference: "Exodus 14", prompt: "Through what did Israel pass on dry ground?", answer: "The Red Sea", options: ["The Red Sea", "The Jordan", "The Nile", "The Sea of Galilee"], explanation: "Israel crossed through the Red Sea on dry ground." },
  { reference: "Exodus 16", prompt: "What bread-like provision did Israel receive in the wilderness?", answer: "Manna", options: ["Manna", "Barley cakes", "Figs", "Locusts"], explanation: "God gave manna as daily bread in the wilderness." },
  { reference: "Joshua 2", prompt: "What sign did Rahab place in her window?", answer: "A scarlet cord", options: ["A scarlet cord", "A palm branch", "A lamp", "A silver chain"], explanation: "Rahab tied a scarlet cord in the window as the sign." },
  { reference: "Joshua 6", prompt: "How many times did Israel march around Jericho on the seventh day?", answer: "Seven times", options: ["Seven times", "Three times", "Twelve times", "Forty times"], explanation: "On the seventh day they circled Jericho seven times." },
  { reference: "Judges 7", prompt: "What did Gideon's men carry with trumpets during the night attack?", answer: "Jars with torches", options: ["Jars with torches", "Bows with arrows", "Scrolls", "Fishing nets"], explanation: "Gideon's men used trumpets, jars, and torches." },
  { reference: "Ruth 1", prompt: "Who said, 'Your people shall be my people'?", answer: "Ruth", options: ["Ruth", "Naomi", "Orpah", "Boaz"], explanation: "Ruth spoke those words to Naomi." },
  { reference: "1 Samuel 3", prompt: "Who helped Samuel understand that the Lord was calling him?", answer: "Eli", options: ["Eli", "Saul", "David", "Nathan"], explanation: "Eli instructed Samuel to answer the Lord's call." },
  { reference: "1 Samuel 17", prompt: "What weapon did David use to strike Goliath first?", answer: "A sling and stone", options: ["A sling and stone", "Saul's sword", "A spear", "A bow"], explanation: "David struck Goliath with a stone from his sling." },
  { reference: "1 Kings 18", prompt: "On which mountain did Elijah confront the prophets of Baal?", answer: "Mount Carmel", options: ["Mount Carmel", "Mount Sinai", "Mount Zion", "Mount Hermon"], explanation: "Elijah's contest with Baal's prophets happened on Mount Carmel." },
  { reference: "2 Kings 5", prompt: "Where did Elisha tell Naaman to wash seven times?", answer: "The Jordan", options: ["The Jordan", "The Nile", "The Red Sea", "The Pool of Siloam"], explanation: "Naaman was told to wash in the Jordan seven times." },
  { reference: "Esther 4", prompt: "Who told Esther she may have come to royalty for such a time as this?", answer: "Mordecai", options: ["Mordecai", "Haman", "Ahasuerus", "Daniel"], explanation: "Mordecai challenged Esther about her royal position." },
  { reference: "Daniel 3", prompt: "Who refused to bow to Nebuchadnezzar's image?", answer: "Shadrach, Meshach, and Abednego", options: ["Shadrach, Meshach, and Abednego", "Peter, James, and John", "Cain, Abel, and Seth", "Eli, Hophni, and Phinehas"], explanation: "The three Hebrew men refused to worship the image." },
  { reference: "Daniel 6", prompt: "Why was Daniel thrown into the lions' den?", answer: "He continued praying to God", options: ["He continued praying to God", "He stole temple gold", "He refused to interpret a dream", "He broke the Sabbath"], explanation: "Daniel kept praying despite the king's decree." },
  { reference: "Jonah 1", prompt: "Where was Jonah trying to flee instead of going to Nineveh?", answer: "Tarshish", options: ["Tarshish", "Jericho", "Damascus", "Bethlehem"], explanation: "Jonah boarded a ship bound for Tarshish." },
  { reference: "Matthew 2", prompt: "What gifts did the wise men bring Jesus?", answer: "Gold, frankincense, and myrrh", options: ["Gold, frankincense, and myrrh", "Silver, oil, and bread", "Figs, wine, and wool", "Spices, linen, and salt"], explanation: "Matthew names gold, frankincense, and myrrh." },
  { reference: "Matthew 4", prompt: "What did Jesus answer when tempted to turn stones into bread?", answer: "Man shall not live by bread alone", options: ["Man shall not live by bread alone", "My hour has not yet come", "Peace, be still", "I am the bread of life"], explanation: "Jesus quoted Scripture about living by every word from God." },
  { reference: "Matthew 14", prompt: "Who walked on water toward Jesus?", answer: "Peter", options: ["Peter", "John", "Thomas", "Andrew"], explanation: "Peter came down from the boat and walked on the water toward Jesus." },
  { reference: "Mark 5", prompt: "What was the name given by the demon-possessed man because they were many?", answer: "Legion", options: ["Legion", "Barabbas", "Mammon", "Beelzebul"], explanation: "He answered, 'My name is Legion, for we are many.'" },
  { reference: "Luke 10", prompt: "Who stopped to help the wounded man in Jesus' parable?", answer: "A Samaritan", options: ["A Samaritan", "A priest", "A Levite", "A tax collector"], explanation: "The Samaritan had compassion and cared for the wounded man." },
  { reference: "Luke 15", prompt: "What did the father put on the returned son's hand?", answer: "A ring", options: ["A ring", "A sword", "A scroll", "A chain"], explanation: "The father ordered a ring for his son's hand." },
  { reference: "John 2", prompt: "At Cana, what did Jesus turn into wine?", answer: "Water", options: ["Water", "Oil", "Milk", "Vinegar"], explanation: "Jesus turned water in stone jars into wine." },
  { reference: "John 11", prompt: "Who did Jesus call out of the tomb?", answer: "Lazarus", options: ["Lazarus", "Jairus", "Stephen", "Joseph"], explanation: "Jesus cried, 'Lazarus, come out.'" },
  { reference: "Acts 9", prompt: "On the road to which city was Saul confronted by Jesus?", answer: "Damascus", options: ["Damascus", "Jerusalem", "Antioch", "Tarsus"], explanation: "Saul was going to Damascus when the light from heaven flashed around him." },
  { reference: "Acts 16", prompt: "What happened while Paul and Silas prayed and sang in prison?", answer: "An earthquake opened the prison", options: ["An earthquake opened the prison", "Fire fell from heaven", "A whale appeared", "The Jordan parted"], explanation: "An earthquake shook the prison and opened doors and chains." },
];

function fallbackQuestion(fact: FallbackFact, index: number, difficulty: string, gameType: string): QuestionPayload {
  const round = index < 6 ? 1 : index < 12 ? 2 : index < 18 ? 3 : 4;
  const prefix = gameType === "ludo" ? `Road ${Math.floor(index / 6) + 1}` : `Arena ${index + 1}`;
  const difficultyPrompt = difficulty === "hard"
    ? "Read carefully:"
    : difficulty === "medium"
      ? "Think before answering:"
      : "Choose the correct detail:";
  return {
    type: "multiple_choice",
    question: `${prefix} · ${difficultyPrompt} ${fact.prompt}`,
    options: fact.options,
    correct_answer: fact.answer,
    explanation: fact.explanation,
    reference: fact.reference,
    difficulty_tag: round === 1 ? "easy" : round === 2 ? "moderate" : "hard",
    game_round: round,
    round_timer_seconds: round === 1 ? 90 : round === 2 ? 72 : round === 3 ? 54 : 10,
    is_bonus: index === 18,
  };
}

function buildFallbackDeck(targetCount: number, difficulty: string, gameType: string, seed: string) {
  const seedValue = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Array.from({ length: targetCount }, (_, index) => {
    const fact = FALLBACK_FACTS[(index + seedValue) % FALLBACK_FACTS.length];
    return fallbackQuestion(fact, index, difficulty, gameType);
  });
}

function isQuotaOrProviderFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /insufficient_quota|credit_balance_exhausted|quota|billing|OPENAI_API_KEY|Question generation failed/i.test(message);
}

async function fetchNarrative(narrativeDate: string | null) {
  if (!narrativeDate) return null;
  const response = await fetch(
    `${env("SUPABASE_URL")}/rest/v1/daily_narratives?narrative_date=eq.${encodeURIComponent(narrativeDate)}&select=title,theme,scripture_reference,main_text&limit=1`,
    { headers: serviceHeaders() },
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return rows?.[0] || null;
}

async function generateBatch(
  openAiKey: string,
  count: number,
  source: string,
  difficulty: string,
  gameType: string,
  packetSeed: string,
  excludedPrompts: string[],
) {
  const formatRule = gameType === "ludo"
    ? "This is a long four-pawn Ludo match. Vary chronology, speakers, motives, consequences, comparisons, and exact details."
    : "This deck is used in three rounds of six questions and one final bonus question.";
  const prompt = `Create exactly ${count} difficult but fair Bible Arena questions for Full Circle.
Rules:
- ${formatRule}
- No repeated or paraphrased questions, vague trivia, incomplete wording, trick ambiguity, or invented facts.
- Use only multiple_choice and true_false. Every question must be answered by tapping a choice.
- Every multiple_choice question must have exactly 4 distinct, plausible options and one exact correct_answer copied from those options.
- Include a precise Bible reference and a concise explanation for every answer. If a fact cannot be supported confidently from Scripture, omit it.
- Require a balanced mix of memory, reasoning, attention to detail, chronology, inference, and textual comparison.
- Requested difficulty: ${difficulty}. Difficulty must come from thought and close reading, not obscure wording.
- Question packet: ${packetLevel(difficulty)}
- Packet seed: ${packetSeed}. Use this seed to vary angle, ordering, and detail focus; do not recreate a previous machine-match deck.
- Source focus: ${source}
- Do not repeat or paraphrase these existing prompts: ${excludedPrompts.slice(-160).join(" | ") || "none"}
Return only JSON: {"questions":[{"type":"multiple_choice","question":"...","options":["..."],"correct_answer":"...","explanation":"...","reference":"..."}]}`;

  const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env("OPENAI_MODEL") || "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a meticulous Bible scholar, assessment writer, and competitive game designer. Return strict JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.45,
      max_tokens: 8000,
    }),
  });
  if (!aiRes.ok) throw new Error(`Question generation failed: ${aiRes.status} ${await aiRes.text()}`);
  const aiData = await aiRes.json();
  const parsed = JSON.parse(aiData.choices?.[0]?.message?.content || "{}");
  return Array.isArray(parsed.questions) ? parsed.questions : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let claimedRoomId = "";
  let claimedUserId = "";
  try {
    const userId = await authenticate(req);
    const openAiKey = env("OPENAI_API_KEY");

    const body = await req.json();
    const roomId = String(body.roomId || "");
    if (!roomId) return json({ error: "roomId is required." }, 400);

    const room = await fetchArenaContext(roomId, userId);
    const gameType = /\[arena:ludo\]/i.test(room.room_name) ? "ludo" : "standard";
    const targetCount = gameType === 'ludo' ? 120 : 19;
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

    const topic = parseRoomTopic(room.room_name);
    const narrative = await fetchNarrative(room.narrative_date);
    const source = topic
      ? `${topic.type}: ${topic.value}`
      : `weekly narrative: ${narrative?.title || "Untitled"}; theme: ${narrative?.theme || ""}; scripture: ${narrative?.scripture_reference || ""}; main text: ${String(narrative?.main_text || "").slice(0, 14000)}`;
    const difficulty = roomDifficulty(room.room_name);
    const packetSeed = [
      roomId,
      difficulty,
      gameType,
      topic ? `${topic.type}:${topic.value}` : room.narrative_date || "weekly",
      new Date().toISOString().slice(0, 13),
    ].join("|");
    let questions: QuestionPayload[] = [];
    try {
      if (!openAiKey) throw new Error("OPENAI_API_KEY is not configured.");
      const seen = new Set<string>();
      const batchSize = gameType === "ludo" ? 30 : targetCount;
      for (let attempt = 0; questions.length < targetCount && attempt < 6; attempt += 1) {
        const remaining = targetCount - questions.length;
        const generated = await generateBatch(
          openAiKey,
          Math.min(batchSize, remaining),
          source,
          difficulty,
          gameType,
          `${packetSeed}|batch:${attempt + 1}`,
          questions.map((question) => question.question),
        );
        for (const item of generated) {
          const cleaned = cleanQuestion(item, questions.length);
          if (!cleaned) continue;
          const key = cleaned.question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          if (seen.has(key) || isNearDuplicate(cleaned.question, questions.map((question) => question.question))) continue;
          seen.add(key);
          questions.push(cleaned);
          if (questions.length >= targetCount) break;
        }
      }
    } catch (error) {
      if (!isQuotaOrProviderFailure(error)) throw error;
      questions = buildFallbackDeck(targetCount, difficulty, gameType, packetSeed);
    }

    if (questions.length < targetCount) questions = buildFallbackDeck(targetCount, difficulty, gameType, `${packetSeed}|short`);
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
        // A two-minute database lease still prevents a permanently stuck room.
      }
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});
