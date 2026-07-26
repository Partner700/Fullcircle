# Full Circle — Game Engine Design

This document defines the actual game engine architecture that the Portal Architecture's "Game Bank & Daily Selection" system slots into. It answers two questions: what makes a game *work for any narrative or scripture passage* rather than being hand-built per story, and how difficulty scales inside a single game from Level 1 to Level 5.

---

## 1. The core design principle

Every game here is a **content-agnostic engine**. None of them are written "for Genesis 22" or "for the Exodus" — each one is a mechanic that takes a small, structured packet of content extracted from *whatever* passage is live that day and renders the same game around it. This is what makes "10 games a day, drawn from a bank, changeable by an instructor" (per the Portal Architecture) actually work: swapping which passage is live never requires touching the game code, only re-feeding it a new content packet.

**This only holds if the packet fields aren't secretly narrative-shaped.** The first draft of this document named fields like `event_sequence` and `entities` — those work fine for Genesis 22, but they quietly assume there's a plot with characters doing things, which breaks the moment the day's passage is a Psalm, a proverb, an epistle argument, or a list of laws. The fix isn't new games — it's naming the packet fields by their *structural role*, not by narrative vocabulary, so the same eight games below work on any genre without modification:

| Packet field | What it is (genre-neutral) | Narrative example (Genesis 22) | Non-narrative example (Psalm 23) |
|---|---|---|---|
| `key_verse` | One verse, exact text, worth memorizing | "God will provide for himself the lamb for a burnt offering, my son." | "The Lord is my shepherd; I shall not want." |
| `ordered_units` | 5–8 short units that have a fixed, correct order — events in a story, but just as often stanzas in a poem, steps in an argument, or generations in a genealogy | Called by God · Took Isaac and wood · Three days' journey · Built the altar · Bound Isaac · Angel called out · Ram provided | Green pastures & still waters · Soul restored, paths of righteousness · The valley of the shadow · Table before enemies · Goodness and mercy follow · Dwelling in the Lord's house |
| `key_terms` | Distinctive names, images, or concepts the passage is actually about — people and places in a narrative, but images/concepts in poetry or wisdom text | Abraham, Isaac, the angel, Moriah, the ram, the altar, the knife | shepherd, still waters, valley of the shadow of death, rod and staff, anointed head, house of the Lord |
| `term_facts` | One short association per term — what a character *did/said* in narrative, or what a term *means/does* in the passage otherwise | "Abraham — said 'God will provide'" / "Isaac — carried the wood" | "rod and staff — what comforts" / "table — prepared in the presence of enemies" |
| `true_false_bank` | 8–12 short true/false statements about the passage | "Isaac carried the fire and the knife." (False — Abraham carried those) | "The psalm says goodness and mercy will follow all the days of my life." (True) |
| `distractor_pool` | Terms/facts from *other* passages of a similar genre, used as wrong answers | Names from other Genesis stories, other altars, other angels | Images from other psalms — a different shepherd psalm, a different "valley," etc. |
| `category_schema` | A simple two- or three-bucket sort — "who did what" in narrative, or a thematic/conceptual split otherwise | "Things Abraham did" vs. "Things Isaac did" vs. "Things the angel did" | "Things the shepherd provides" vs. "Things the psalmist feels/experiences" |

Once a passage has this packet — filled in appropriately for its genre — every game below can run against it without modification. This is the same discipline the rest of the architecture already uses (one Tent card shape, one board row shape) applied to games.

**A practical note for whoever preps content**: for narrative passages, `ordered_units` and `key_terms` fill themselves in almost automatically from the plot and cast. For non-narrative passages, they take a little more judgment — `ordered_units` becomes "the passage's own internal structure" (a psalm's stanzas, an epistle's line of argument, a genealogy's sequence), and `key_terms` becomes "the handful of images or ideas a reader should walk away holding onto." That's a content-prep skill, not a game-engine limitation — once it's done, the eight games below don't know or care which genre they're playing against.

---

## 2. The Stage Ladder — one shared difficulty template, used by every game

This is the second core idea, and it's what makes "speed vs. accuracy" a real, felt tension rather than a label. Every game has exactly **5 stages**, and every game uses the *same* underlying ladder — only the content and the specific UI differ between games. The ladder is a progression along one axis: how much the clock punishes hesitation, and how much a mistake costs.

| Stage | Time pressure | Mistake cost | Format | What it feels like |
|---|---|---|---|---|
| **1 — Foundation** | Generous or no timer | Free retry, no penalty | Multiple choice, hints available | Pure learning. No tension yet — this stage exists so the content gets absorbed before it gets tested. |
| **2 — Building** | Soft timer (plenty of time per item) | Small point deduction, no run-ending | Multiple choice, hints cost points instead of being free | Tension introduced gently — a clock is visible for the first time. |
| **3 — Balanced** | Real timer, matched to average completion time | Meaningful point loss, no elimination yet | Multiple choice or short-select, no hints | This is the stage where speed and accuracy start to genuinely compete — going carefully costs time, going fast costs accuracy. |
| **4 — Pressure** | Tight timer, faster than average completion time | A wrong answer can end the attempt or force a restart of the current item set | Typed/recalled answers where the game supports it, not just multiple choice | The trade-off is sharp now — a cadet has to commit to a pace and live with it. |
| **5 — Blitz** | Hardest timer, no slack | One mistake can end the run entirely | Verbatim/typed recall wherever the game supports it, minimal or no visual scaffolding | Maximum tension: the cadet needs both full mastery of the content *and* the speed to express it under pressure — this is the only stage where speed and accuracy are both maximally demanded at once, rather than traded off. |

**Why this is one ladder and not five different designs per game:** a cadet who's played any game in the bank already understands what "Stage 3" or "Blitz" *means* emotionally the first time they hit it in a new game — the ladder is a promise that stays consistent across the whole bank, the same way a Tent card or a board row always looks and behaves the same regardless of which screen it's on.

**How this maps onto the Portal Architecture's Level slots**: each of the 10 daily Level slots holds one game from the bank (per the existing Game Bank & Daily Selection system). A cadet climbing through a single day's Level doesn't just finish it once — they climb that game's own 5-stage ladder *within* that slot. Completing Stage 5 of the game in a slot is what unlocks moving to the next Level slot, the same way the existing session state machine already described Normal → Blitz → Next Level; this document replaces that binary Normal/Blitz idea with the fuller 5-stage ladder above, applied uniformly.

---

## 3. The games

Eight engines, each described as: what it tests, what packet fields it needs, and what changes stage-to-stage. All eight now run on `ordered_units` / `key_terms` / `term_facts` rather than narrative-only fields, so every one of them works on narrative *and* non-narrative scripture — genre changes what the content looks like, never which games are available.

### 1. Sequence
**Tests**: whether the cadet knows the passage's own internal order. **Uses**: `ordered_units`. Cadet arranges shuffled units into correct order. In a narrative, that's plot events; in a psalm or epistle, it's stanzas or steps in the argument — the mechanic doesn't change.
- Stage 1: 5 units, drag-to-reorder, no timer.
- Stage 3: 7 units, a visible countdown, one point lost per swap made after the first correct guess.
- Stage 5: all 8 units, typed as a numbered list from memory, hard timer, one wrong slot ends the run.

### 2. Cloze (Fill-in-the-Blank)
**Tests**: verse memorization. **Uses**: `key_verse`. A verse appears with one word removed; the cadet supplies it. Genre-neutral by nature — every passage has a key verse.
- Stage 1: multiple choice (4 options), untimed.
- Stage 3: multiple choice, timed, two words removed.
- Stage 5: no options — the cadet types the missing word(s) from memory, tight timer.

### 3. Matching
**Tests**: what each key term does or means in the passage. **Uses**: `key_terms` + `term_facts`. Cadet pairs each term with its fact. In narrative that reads as "who said/did this"; in wisdom or poetic text it reads as "what does this image represent" — same pairing mechanic either way.
- Stage 1: 3 pairs, untimed, no wrong-pair penalty.
- Stage 3: 5 pairs, timed, wrong pairs cost points.
- Stage 5: 7 pairs against a shared timer for the whole set, one wrong pair ends the round.

### 4. True or False
**Tests**: attentiveness to detail. **Uses**: `true_false_bank`. Rapid-fire statements, judge true/false. Fully genre-neutral — any passage yields true/false statements about its content.
- Stage 1: 6 statements, no timer per statement, wrong answers just move on.
- Stage 3: 10 statements, 5 seconds each.
- Stage 5: 12 statements, 2 seconds each, three wrong answers ends the run.

### 5. Which One Doesn't Belong (Elimination)
**Tests**: whether the cadet can tell this passage's specifics from a lookalike. **Uses**: `key_terms` + `distractor_pool`. A grid of 4–6 items, one (or more) doesn't belong to this passage — the cadet eliminates the impostor(s). Works identically whether the terms are narrative characters or thematic images from a psalm.
- Stage 1: 4 items, one obvious impostor, untimed.
- Stage 3: 5 items, one subtle impostor (same category, different passage), timed.
- Stage 5: 6 items, two impostors, tight timer, must catch both to pass.

### 6. Spot It
**Tests**: recognition speed. **Uses**: `key_terms` + `distractor_pool`. Items scroll or pop up briefly (whack-a-mole style); tap only ones that belong to this passage.
- Stage 1: slow pace, generous window per item, mistakes ignored.
- Stage 3: moderate pace, mistakes cost points.
- Stage 5: fast pace, mistakes cost a life, three lives per run.

### 7. Verbatim Recall
**Tests**: exact memorization — the hardest, most accuracy-demanding game in the bank by design, so it's the natural fit for a Blitz-only slot (per the existing architecture's Level 10 rule). **Uses**: `key_verse`. Cadet types the verse from memory, exact wording checked. Fully genre-neutral.
- Stage 1: verse shown, cadet copies it once (pure familiarization, not yet tested).
- Stage 3: verse shown for 10 seconds, then hidden, cadet types it from memory, minor typos forgiven.
- Stage 5: verse never shown this session — pure recall from prior exposure, typed exactly, zero tolerance for wording errors, hard timer.

### 8. Category Sort
**Tests**: structural comprehension. **Uses**: `category_schema` + `term_facts`. Cadet sorts a shuffled set of facts into the correct bucket. In narrative that's "who did what"; in wisdom or epistle text the buckets are thematic (e.g. "wisdom vs. folly," "what the shepherd provides vs. what the psalmist feels") — arguably the more natural fit for non-narrative text, if anything.
- Stage 1: 2 buckets, 6 items, untimed.
- Stage 3: 3 buckets, 9 items, timed.
- Stage 5: 3 buckets, 12 items (some ambiguous/borderline), tight timer, wrong bucket costs a life.

---

## 4. What this replaces in the Game Bank

The `GameBankEntry` catalog from the Portal Architecture's Game Bank section should reference these eight engines (by `mechanic`) rather than one-off invented names — the earlier prototype's placeholder names (Spot the Profanation, The Interrogator, etc.) were exactly that, placeholders, and should be renamed to whichever of these eight mechanics they're actually meant to be, or dropped if they don't map to one. An instructor selecting "10 games for today" is really selecting 10 *(mechanic, content packet)* pairs — since the content packet is just whatever passage is currently live, the actual instructor-facing choice is simpler than it first looks: pick which 10 of these 8 mechanics are in rotation (with repeats, since there are more slots than mechanics), and the passage-of-the-day fills in the content automatically.
