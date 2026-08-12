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
  bank: string;
  reference: string;
  prompt: string;
  answer: string;
  options: string[];
  explanation: string;
};

const ARENA_BANKS = {
  characters: [
    "Adam and Eve", "Noah", "Abraham", "Joseph", "Moses", "Rahab", "Gideon", "David", "Elijah", "Daniel",
  ],
  books: [
    "Genesis", "Exodus", "Joshua", "Judges", "Ruth", "1 Samuel", "1 Kings", "Daniel", "Luke", "Acts",
  ],
  themes: [
    "creation", "fall and exile", "covenant", "deliverance", "faith under pressure", "kingdom and leadership", "wisdom and folly", "repentance", "salvation", "resurrection hope",
  ],
} as const;

function bankFocus(seed: string) {
  const categories = Object.keys(ARENA_BANKS) as Array<keyof typeof ARENA_BANKS>;
  const seedValue = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const category = categories[seedValue % categories.length];
  const bank = ARENA_BANKS[category][Math.floor(seedValue / categories.length) % ARENA_BANKS[category].length];
  return { category, bank };
}

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
  const seconds = round === 1 ? 12 : round === 2 ? 9 : 6;
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
    difficulty_tag: "hard",
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
  if (difficulty === "easy") return "Fast Arena packet: every question is hard but the machine is weaker; use 12-second player turns.";
  if (difficulty === "medium") return "Fast Arena packet: every question is hard and denser; use 9-second player turns.";
  if (difficulty === "hard") return "Fast Arena packet: every question is hard, close-reading based, and tense; use 6-second player turns.";
  return "Fast Arena packet: all questions are hard, varied, and built for speed plus accuracy.";
}

const FALLBACK_FACTS: FallbackFact[] = [
  { bank: "Bible Characters", reference: "Genesis 3", prompt: "Adam blamed Eve, but what did his answer also imply about God?", answer: "That the woman God gave him was involved", options: ["That the woman God gave him was involved", "That the serpent forced him physically", "That the tree was wrongly named", "That Eve ate after he refused"], explanation: "Adam says, 'The woman whom you gave to be with me, she gave me fruit...'" },
  { bank: "Bible Characters", reference: "Genesis 22", prompt: "What phrase shows Abraham expected to return with Isaac despite the command to sacrifice him?", answer: "We will come again to you", options: ["We will come again to you", "The boy will remain here", "I alone will worship", "God has rejected the lad"], explanation: "Abraham tells the servants, 'I and the boy will go... and come again to you.'" },
  { bank: "Bible Characters", reference: "Genesis 45", prompt: "Joseph's interpretation of his betrayal centers on which claim?", answer: "God sent him before them to preserve life", options: ["God sent him before them to preserve life", "His brothers had acted without guilt", "Egypt was his permanent inheritance", "Jacob planned the famine"], explanation: "Joseph says God sent him before them to preserve life." },
  { bank: "Bible Characters", reference: "Exodus 4", prompt: "Which objection from Moses did God's anger answer by appointing Aaron?", answer: "That Moses was not eloquent", options: ["That Moses was not eloquent", "That Pharaoh was already dead", "That Israel had no elders", "That the signs were forbidden"], explanation: "Moses objects about speech; God appoints Aaron as spokesman." },
  { bank: "Bible Characters", reference: "Joshua 2", prompt: "Rahab's confession proves she acted from what conviction before Israel arrived?", answer: "The Lord had given Israel the land", options: ["The Lord had given Israel the land", "Jericho had invited Israel peacefully", "The spies were her relatives", "The king had already surrendered"], explanation: "Rahab says she knew the Lord had given them the land." },
  { bank: "Bible Characters", reference: "Judges 7", prompt: "Why did God reduce Gideon's army before battle?", answer: "So Israel would not boast that its own hand saved it", options: ["So Israel would not boast that its own hand saved it", "Because the Midianites requested equal numbers", "Because Gideon had no weapons", "So the battle could be postponed"], explanation: "God says the people are too many lest Israel boast against Him." },
  { bank: "Bible Characters", reference: "1 Samuel 24", prompt: "What kept David from killing Saul in the cave?", answer: "Saul was the Lord's anointed", options: ["Saul was the Lord's anointed", "Jonathan was standing between them", "David had no blade", "Samuel forbade all cave battles"], explanation: "David refuses to put out his hand against the Lord's anointed." },
  { bank: "Bible Characters", reference: "1 Kings 19", prompt: "What corrected Elijah's assumption that he alone remained faithful?", answer: "God had preserved seven thousand in Israel", options: ["God had preserved seven thousand in Israel", "Jezebel had secretly repented", "Ahab had destroyed Baal", "Obadiah became king"], explanation: "God says He left seven thousand who had not bowed to Baal." },
  { bank: "Bible Characters", reference: "Daniel 6", prompt: "Daniel's enemies targeted him through which predictable habit?", answer: "His faithfulness in prayer to God", options: ["His faithfulness in prayer to God", "His refusal to interpret dreams", "His habit of eating royal food", "His fear of lions"], explanation: "They knew they would find ground against him only in relation to God's law." },
  { bank: "Bible Characters", reference: "Acts 9", prompt: "What reversed Ananias's fear of Saul?", answer: "The Lord said Saul was a chosen instrument", options: ["The Lord said Saul was a chosen instrument", "Saul had already healed Ananias", "The high priest cancelled every letter", "Barnabas arrived first"], explanation: "The Lord tells Ananias Saul is a chosen instrument." },
  { bank: "Books of the Bible", reference: "Genesis 50", prompt: "Which theme closes Genesis through Joseph's words to his brothers?", answer: "Human evil being overruled by God's saving purpose", options: ["Human evil being overruled by God's saving purpose", "Egypt replacing Canaan as the promise", "Jacob's sons being declared sinless", "Famine ending the covenant"], explanation: "Joseph says they meant evil, but God meant it for good to save many." },
  { bank: "Books of the Bible", reference: "Exodus 12", prompt: "Which Exodus detail ties deliverance to substitution rather than escape strategy?", answer: "The Passover blood marked the houses", options: ["The Passover blood marked the houses", "The Israelites mapped secret roads", "Moses bribed Pharaoh's servants", "The Nile dried before the plague"], explanation: "Judgment passed over houses marked by blood." },
  { bank: "Books of the Bible", reference: "Joshua 7", prompt: "What makes Achan's sin affect the whole camp in Joshua?", answer: "Israel had broken faith over devoted things", options: ["Israel had broken faith over devoted things", "Joshua forgot the ark at Jericho", "Ai was stronger than Jericho", "Rahab betrayed the spies"], explanation: "The text speaks corporately: Israel had sinned by taking devoted things." },
  { bank: "Books of the Bible", reference: "Judges 21", prompt: "Which repeated idea explains the moral collapse in Judges?", answer: "There was no king and everyone did what was right in his own eyes", options: ["There was no king and everyone did what was right in his own eyes", "The tabernacle had been destroyed by Philistines", "Moses was still alive but silent", "The land had no judges at all"], explanation: "Judges repeatedly frames chaos with this line." },
  { bank: "Books of the Bible", reference: "Ruth 4", prompt: "Ruth's ending links ordinary faithfulness to which larger biblical line?", answer: "The line of David", options: ["The line of David", "The line of Pharaoh", "The priesthood of Aaron", "The fall of Jericho"], explanation: "Ruth ends with genealogy leading to David." },
  { bank: "Books of the Bible", reference: "1 Samuel 15", prompt: "What does Samuel say is better than sacrifice?", answer: "Obedience", options: ["Obedience", "Silence", "Speed", "Victory songs"], explanation: "Samuel tells Saul obedience is better than sacrifice." },
  { bank: "Books of the Bible", reference: "1 Kings 12", prompt: "What immediate result followed Rehoboam's harsh answer?", answer: "The kingdom divided", options: ["The kingdom divided", "The temple burned", "Elijah crowned Jeroboam", "Babylon invaded"], explanation: "Israel rebelled against the house of David after Rehoboam's answer." },
  { bank: "Books of the Bible", reference: "Daniel 3", prompt: "What makes the furnace testimony more than private courage?", answer: "A pagan king publicly blesses their God", options: ["A pagan king publicly blesses their God", "The image turns into gold dust", "Daniel replaces Nebuchadnezzar", "The men escape before being thrown in"], explanation: "Nebuchadnezzar blesses the God who delivered them." },
  { bank: "Books of the Bible", reference: "Luke 15", prompt: "What links the lost sheep, coin, and son in Luke 15?", answer: "Joy over what was lost being found", options: ["Joy over what was lost being found", "Anger that sinners cannot return", "A command to avoid feasts", "A warning against shepherds"], explanation: "Each parable ends with joy over recovery." },
  { bank: "Books of the Bible", reference: "Acts 10", prompt: "What shift does Peter confess after Cornelius receives the word?", answer: "God shows no partiality", options: ["God shows no partiality", "Gentiles must first become Sadducees", "Caesarea replaces Jerusalem", "Visions cancel preaching"], explanation: "Peter says he understands God shows no partiality." },
  { bank: "Themes of Scripture", reference: "Genesis 1", prompt: "Creation's repeated 'good' language primarily teaches what about the world?", answer: "It comes ordered and blessed from God", options: ["It comes ordered and blessed from God", "It is divine and should be worshiped", "It was made by human kings", "It is morally evil from the start"], explanation: "Genesis presents creation as ordered by God's word and repeatedly good." },
  { bank: "Themes of Scripture", reference: "Genesis 3", prompt: "The fall begins not with open atheism but with what kind of distortion?", answer: "Questioning and contradicting God's word", options: ["Questioning and contradicting God's word", "A failed harvest sacrifice", "A dispute over city walls", "A refusal to name the animals"], explanation: "The serpent questions and contradicts God's command." },
  { bank: "Themes of Scripture", reference: "Genesis 12", prompt: "The Abrahamic promise moves blessing toward whom?", answer: "All the families of the earth", options: ["All the families of the earth", "Only the kings of Egypt", "Only Abraham's servants", "The Nephilim alone"], explanation: "God says all families of the earth will be blessed in Abram." },
  { bank: "Themes of Scripture", reference: "Exodus 6", prompt: "In Exodus, redemption is grounded first in what?", answer: "God remembering His covenant", options: ["God remembering His covenant", "Israel's military preparation", "Pharaoh's generosity", "Moses mastering Egyptian magic"], explanation: "God hears, remembers His covenant, and acts." },
  { bank: "Themes of Scripture", reference: "Leviticus 16", prompt: "The Day of Atonement most directly addresses which problem?", answer: "Israel's uncleanness and sins before a holy God", options: ["Israel's uncleanness and sins before a holy God", "The need to elect a king", "The lack of rain in Egypt", "The building of Jericho"], explanation: "Leviticus 16 centers cleansing from sins and uncleannesses." },
  { bank: "Themes of Scripture", reference: "2 Samuel 7", prompt: "The Davidic covenant turns kingship into a promise about what?", answer: "An enduring house, kingdom, and throne", options: ["An enduring house, kingdom, and throne", "A king without descendants", "A temple built by David that night", "A priesthood replacing Aaron"], explanation: "God promises David an enduring house and throne." },
  { bank: "Themes of Scripture", reference: "Psalm 51", prompt: "David's repentance asks God for what inner restoration?", answer: "A clean heart and right spirit", options: ["A clean heart and right spirit", "A larger army", "A hidden throne", "A second crown"], explanation: "David prays, 'Create in me a clean heart... renew a right spirit.'" },
  { bank: "Themes of Scripture", reference: "Isaiah 53", prompt: "The servant's suffering is portrayed as doing what for many?", answer: "Bearing sin and bringing healing", options: ["Bearing sin and bringing healing", "Escaping all pain by force", "Ending sacrifice by denying guilt", "Replacing Israel with Assyria"], explanation: "The servant bears griefs, transgressions, and brings healing." },
  { bank: "Themes of Scripture", reference: "John 11", prompt: "Jesus' 'resurrection and life' claim is tested in the scene by what?", answer: "Calling Lazarus from the tomb", options: ["Calling Lazarus from the tomb", "Turning stones into bread", "Calming a storm in Galilee", "Writing on palace walls"], explanation: "The claim is followed by Lazarus being called out." },
  { bank: "Themes of Scripture", reference: "Revelation 21", prompt: "The end-times hope is not escape into emptiness but what picture?", answer: "God dwelling with His people in a renewed creation", options: ["God dwelling with His people in a renewed creation", "The sea ruling over heaven", "A city without God's presence", "The serpent crowned over nations"], explanation: "Revelation shows the holy city and God dwelling with His people." },
];

function fallbackQuestion(fact: FallbackFact, index: number, difficulty: string, gameType: string): QuestionPayload {
  const round = index < 6 ? 1 : index < 12 ? 2 : index < 18 ? 3 : 4;
  const prefix = gameType === "ludo" ? `Road ${Math.floor(index / 6) + 1}` : `Arena ${index + 1}`;
  const lenses = [
    "Which detail best survives a close reading?",
    "Which option fits the sequence without smuggling in a false detail?",
    "Which answer explains the consequence most precisely?",
    "Which choice sounds plausible but is actually the exact Scriptural detail?",
  ];
  const difficultyPrompt = lenses[index % lenses.length];
  return {
    type: "multiple_choice",
    question: `${prefix} · ${difficultyPrompt} ${fact.prompt}`,
    options: fact.options,
    correct_answer: fact.answer,
    explanation: fact.explanation,
    reference: fact.reference,
    difficulty_tag: "hard",
    game_round: round,
    round_timer_seconds: round === 1 ? 12 : round === 2 ? 9 : 6,
    is_bonus: index === 18,
  };
}

function buildFallbackDeck(targetCount: number, difficulty: string, gameType: string, seed: string) {
  const seedValue = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const focus = bankFocus(seed);
  const sortedFacts = [...FALLBACK_FACTS].sort((left, right) => {
    const leftScore = [...`${seed}|${left.reference}`].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const rightScore = [...`${seed}|${right.reference}`].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return leftScore - rightScore;
  });
  const preferredFacts = sortedFacts.filter((fact) => fact.bank.toLowerCase().includes(focus.category === "characters" ? "characters" : focus.category === "books" ? "books" : "themes"));
  const facts = preferredFacts.length >= Math.min(targetCount, 10) ? [...preferredFacts, ...sortedFacts.filter((fact) => !preferredFacts.includes(fact))] : sortedFacts;
  return Array.from({ length: targetCount }, (_, index) => {
    const fact = facts[(index * 7 + seedValue) % facts.length];
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
- Requested machine level: ${difficulty}. Every question must still be hard; the level only affects timer pressure and machine accuracy.
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
