# Full Circle — Scripture Insights editorial standards

**Approved direction:** Scripture-first teaching, with original-language, historical, spiritual, and Kingdom connections. Accessible to an inquisitive primary-school reader without becoming childish. Each entry should leave the reader knowing something definite.

## Source hierarchy
1. **The verse in context comes first.** Never teach against the passage to make a modern leadership lesson.
2. **History is independently verifiable.** Archaeological evidence can establish that a city, ruler, inscription, dynasty, structure, or practice existed; never claim it proves a miracle, a prophetic interpretation, or an otherwise unattested event.
3. **Original-language notes** must reflect supported Hebrew, Aramaic, Greek, or Latin meanings; avoid speculative word games. Latin is appropriate to later textual history, not as the language of the Hebrew original.
4. **User-supplied theological books** inform spiritual interpretation and patterns, not archaeological verification. Draw on ideas rather than reproducing copyrighted pages.
5. **Source titles and author names appear only in small source notes, not in the main Instructor Insight.**
6. **Modern applications must preserve the text's priorities.** Example: Judges 7:2 contrasts Israel's self-congratulation with God's deliverance; it does not prohibit thanking Gideon for obedient service.

## Principal historical evidence research source — Answers in Genesis (AiG)

- **Answers in Genesis is a principal discovery and apologetics research source** for the Historical Context and Did You Know? streams, alongside the Bible, original-language references, and direct archaeological evidence.
- Prioritize its *Archaeology* collection, *Answers Bible Curriculum* and age-appropriate teaching resources, and articles discussing independently identifiable artifacts, rulers, ancient cities, inscriptions, historical records, and manuscript discoveries.
- Follow the child's curiosity: begin with a specific surprise ("An enemy king wrote David's family name on stone!"), explain the relevant find in plain, vivid words, and end with exactly what is independently corroborated.
- Include **AiG article title and URL in the small source notes**, plus the relevant museum, artifact catalogue, primary inscription, or scholarly archaeological source when available. Keep article names/authors out of main insight prose, as previously requested.
- AiG advocates a **young-earth creationist interpretation** of origins and historical chronology. Teach its perspective as a perspective when relevant; do not turn a disputed chronology, speculative archaeological identification, creation-science interpretation, or proposed prophetic parallel into an established material fact.
- Do not confuse **a real person's or place's existence**, **a plausible background**, and **independent confirmation of a specific episode**. All three deserve different language.
- Avoid relying on a single apologetics summary if the find can be checked at its museum or in a primary scholarly description. One AiG article itself emphasizes that archaeology *corroborates rather than conclusively proves every biblical detail*: https://answersingenesis.org/archaeology/fact-checking-bible/
- Separate genres: **Historical Context** presents the researched history, **Did You Know?** presents short memorable verified discoveries, and **Instructor Insight** provides the passage-led spiritual/Kingdom application.

Research starting points:
- https://answersingenesis.org/archaeology/
- https://answersingenesis.org/archaeology/6-archaeological-finds/
- https://answersingenesis.org/archaeology/fact-checking-bible/
- https://answersingenesis.org/church-edition/abc-1st-edition/

## Preferred study lenses from the user's supplied books

- Jonathan Cahn — *The Book of Mysteries*: Hebrew imagery, cross-Testament patterns, feasts, language, covenant, and the significance of biblical details. *The Paradigm*, *The Avatar*, and *The Josiah Manifesto*: explore patterns carefully as **interpretations**, not proof that a modern person is identical to a biblical character.
- Rick Joyner — *The Final Quest*, *The Call*, and *There Were Two Trees in the Garden*: examine humility, discernment, the cross, spiritual conflict, and the danger of self-exaltation. Visionary experiences must be attributed in source notes and not presented as an independently documented historical event.
- Myles Munroe — *Rediscovering the Kingdom*, *Applying the Kingdom*, *Spirit of Leadership*, and related books: God's kingship, dominion as entrusted stewardship, purpose, citizenship, delegated authority, and the difference between a leader's assignment and the source of the leader's authority.

These are theological perspectives adopted for the app's editorial voice. They are not asserted as neutral scholarly consensus.

## Plain-language and scholarly-literacy discovery types

Every Did You Know? should answer a clear question arising from the **exact verse**, using simple language for curious younger readers without talking down to them. The field `scripture_did_you_know.category` labels the type:

- `plain_language` — translate an unfamiliar expression into a modern equivalent; e.g., *middle watch* in Judges 7:19 was the middle night guard shift, approximately 10 PM–2 AM under a three-watch system, **not an exact universal clock time**.
- `ancient_culture` — explain what watches, city gates, threshing floors, inheritance, covenants, lamps, shekels, sandals, guest rooms and other ordinary details meant to the people who used them.
- `scholarly_agreement` — describe broad agreement with accurate scope; e.g., Pilate's office is independently attested, while evidence for a ruler does not prove all reported conversations.
- `scholarly_debate` — name the real issue and significant views without pretending every suggestion is equally supported; e.g., authorship, composition, original-language nuances, manuscript variants, disputed archaeological identification.
- `earliest_evidence` — carefully distinguish the **first book in the Bible's order**, the **first book composed**, the **oldest surviving fragment**, the **earliest discovered fragment**, the **earliest substantially complete scroll**, and the **oldest complete manuscript**. A find's *date of discovery* is different from its *date of copying*.
- `original_language` — a checked Hebrew, Aramaic, Greek, or historically relevant Latin word, with transliteration and one useful contextual meaning.
- `textual_connection` — surprising internal Bible cross-reference, with the relevant references.
- `scripture_detail` — a precise unusual detail readers can check directly in the passage.

When the earliest author or book cannot be established, say that scholars disagree rather than declaring Job, Genesis, or another book the uncontested first-written work. Present the strongest evidence for a debated wording/chronology and cite the work in the small source note.

For technical terms, spell out what the event or object would look like *today*, then note how the ancient system differs. This is the model for bringing every translation into understandable language without rewriting the Bible itself.

## Did You Know? is different from Instructor Insights

- Each chapter in the **66-book, 1,189-chapter canon** must ultimately have at least **two different verified facts**, placed on different verses wherever the chapter has enough verses.
- Each fact: one surprising, specific point, in plain language (usually 25–55 words); a small supporting source note; no unsupported numerical, philological, or archaeological assertion.
- Mix literary discoveries, exact in-text observations, responsible language notes, and tangible historical attestations. No repetitive templates, vague devotional slogans, or generic chapter summaries.
- Editorial coverage is tracked with `scripts/scripture-did-you-know-coverage.sql`. A chapter with zero or one published fact is **incomplete**; it must not receive invented placeholders.
- Distribute work across books, Testaments, narrative, prophecy, poetry, and epistles; do not spend all available effort on Genesis or a current daily reading.
- A supplied trivia collection explicitly warns some claims are unchecked. Treat it as a list of leads to verify, not a batch of ready-to-publish facts.

## Instructor Insights
- Show only categories that add **distinct, relevant** context to the verse. Three sections are exceptional, not required.
- Historical: accurate, memorable, qualified; cite inscriptions and known finds in notes.
- Spiritual: a concrete biblical pattern or theological insight, including meaningful cross-references, and explicitly distinguish interpretation where needed.
- Present day: a tightly anchored application that does **not contradict the passage**.
- Avoid duplicated information across neighboring verses, formulaic applications, naming authors in main text, and inflated certainty.

## Publishing requirements
- Before deploying new facts, check exact references, edition availability, duplicates, RLS read access, and canonical chapter coverage.
- Historical notes should be verified against trustworthy primary archaeological collections or scholarship when relevant.
- Publish only source-grounded, reviewed facts; do not auto-populate 2,378 entries solely to satisfy the numeric target.
