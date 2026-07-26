# Full Circle — Design Rules (extracted from PARROT reference)

These are the *structural and feel* rules pulled from the PARROT screenshots — card anatomy, type behavior, spacing, iconography, motion, layout patterns. Color values below are noted as **reference roles**, not final hex — per your note, the actual palette gets swapped later (likely to the ink/brass/parchment system from the architecture doc). What should carry over is *how* color is used, not which color.

---

## 1. Overall Feel

Warm, low-contrast dark theme that reads as premium-casual rather than corporate SaaS — closer to a cultural pride app or a cozy late-night study space than a dashboard. Generous negative space even though the theme is dark; hierarchy is carried by type weight and a couple of punchy accent colors, not by boxes-within-boxes or heavy borders. Nothing shouts except the CTAs — everything else sits quietly until you need it.

For Full Circle, this feel translates directly: replace PARROT's "cultural pride / language reclamation" warmth with "ceremonial discipleship" warmth. Same restraint, same punchy CTA-only color use, same generous breathing room.

## 2. Color System (roles, not final values)

PARROT uses exactly **three tonal layers** and **two accent colors**, and nothing else:

| Role | PARROT's current value | What it's doing |
|---|---|---|
| Base background | near-black warm brown/espresso | recedes completely, never competes with content |
| Card surface | one step lighter than base, hairline border only | just enough separation to read as a card, no drop shadows |
| Primary text | warm off-white/cream | headlines |
| Secondary text | muted warm tan/gray | body copy, subtitles, metadata |
| Accent 1 (primary action) | vivid orange | primary CTA buttons, "live" emphasis, the one word in a headline that needs to pop |
| Accent 2 (secondary action) | mustard/gold | secondary CTA buttons, "next up" states, locked-but-approaching states |

**The rule to keep:** two accent colors only, each with one clear job — one for "go/primary," one for "almost/secondary" — everything else in the interface is base, surface, or text tone. Resist the urge to add a third accent color for a new feature; reuse one of the two and differentiate with icon/label instead. When Full Circle's palette goes in, map brass → Accent 1 (primary), and pick a secondary tone (could be the moss green or a warmer gold-bronze) → Accent 2, keeping the same two-accent discipline.

Status badges (`LIVE`, `COMING SOON`) use a **translucent tint of the badge's own color** as its background — not a solid fill, not a neutral gray chip. This is a small but important detail: it's what keeps the badges feeling embedded in the dark surface rather than pasted on top of it.

## 3. Typography

- **Display/headline**: bold, rounded, geometric sans — big, confident, tight line-height. Headlines are allowed to break across 3–4 lines at a very large size in the hero; this is a "statement" typographic moment, not a compact one.
- **Body**: same family, regular weight, muted secondary tone, notably smaller than the headline (the contrast between headline and body size is large and deliberate).
- **Eyebrow/label text**: uppercase, wide letter-spacing, small size, often paired with a small icon or dot (`LIVE ✦`, `COMING SOON`, `YOUR JOURNEY`).
- **Native-language moments**: PARROT deliberately renders greeting text in the target language first, large and bold ("Ẹ káàbọ̀, Hakol"), with the translation as a smaller subtitle underneath. This is a strong, reusable pattern — **for Full Circle, the direct equivalent is rendering the day's verse or the day's meditation prompt in the same "big statement first, plain translation/paraphrase underneath" structure**, rather than treating scripture as body text.

## 4. Iconography & Signature Motifs

- Simple **outline icons**, ~1.5px stroke, one per feature card (book, game controller, music note, compass, globe) — never filled/solid icons, never photographic.
- A small **diamond/rhombus bullet (◇)** precedes each item in the vertical "journey" list — a tiny, consistent glyph that gives the list its own identity beyond generic bullets or numbers. **Full Circle already has an equivalent-strength motif ready to go here: the tent house seals.** Use a small house-seal glyph the same way PARROT uses its diamond — as the recurring "this is a Full Circle list" signal, not just on leaderboards but anywhere a list of items needs a consistent, branded marker (daily game levels, award lists, quiz question review).
- The hero mascot (a rounded silhouette shape with a directional chevron/arrow and a triangular "pointer") functions as the brand's one big iconic shape — bold, single-color, instantly recognizable at a glance. Full Circle's equivalent should be one signature shape used sparingly but prominently (the lamp motif already designed for the streak card is a strong candidate to promote to this role — e.g., as the loading-screen icon and the landing-page hero graphic, not just the streak card).

## 5. Card Anatomy (the reusable unit)

Every feature/status card follows the same skeleton, in this order, top to bottom:
1. Status eyebrow badge (translucent tint, uppercase, small)
2. Icon (outline style, sits alone, no background circle)
3. Title (bold, medium-large)
4. One to two lines of muted description
5. A single CTA button, full-width or near-full-width within the card

No card deviates from this order. Consistency here is what makes a grid of six different feature cards feel like one system instead of six one-off designs. Full Circle's dashboard cards (Today's Reading, Daily Game, Weekly Quiz, Challenge) should be re-checked against this exact skeleton — right now they're close but not identical in ordering, and tightening that is worth doing when the reskin happens.

## 6. The "Journey / Level List" Pattern

This is the most directly reusable pattern for Full Circle's 10-level daily game campaign and any other progression list (awards ladder, quiz history):

- A **summary header card** sits above the list: current position ("Level 1 of 5"), a thin progress bar, and a one-line stats string separated by middot characters ("0 words learned · 1 day streak 🔥"). Full Circle equivalent: "Level 7 of 10 · 640 Ð earned today · 3 relics."
- Each list item below is its own card with a **colored left-edge border** indicating state:
  - Active/current item → primary accent left border, full-color title, enabled CTA ("Begin")
  - Next-up-but-locked item → secondary accent left border, full-color title, but CTA replaced with a disabled "Locked" pill and a small "Complete Level 1 first" condition badge
  - Far-future/coming-soon items → no colored border (neutral), muted/desaturated title, "Coming soon" badge, no CTA at all
- This three-tier left-border state system (active / next-up-locked / far-future) is more expressive than a flat locked/unlocked binary, and maps cleanly onto Full Circle's Normal→Blitz→Next Level progression (Section 8 of the architecture doc) — the current sub-stage gets the primary border, the next sub-stage gets the secondary border, everything beyond that is neutral.

## 7. Loading / Transition Screens

Between major navigations, PARROT shows a centered version of its mascot icon, a rotating **"did you know" cultural fact** ("Yoruba has over 500 distinct dialects"), and a thin progress bar beneath it. This turns dead loading time into a small moment of content rather than a blank spinner.

**Direct Full Circle equivalent:** rotate a short scripture fact, a historical note about the day's passage, or a past quote-of-the-day between page loads — same layout (icon, one line of text, thin progress bar), same function of making the wait itself feel like part of the formation experience rather than dead time.

## 8. Landing Page Hero Pattern

- Full-bleed dark background with **translucent floating word-bubbles** scattered across it — in PARROT's case, greetings in different African languages, each in a faint pill outline, positioned at varying depths/opacities to suggest atmosphere without competing with the foreground text.
- Bold multi-line headline (mixed weight — most of it in primary text color, one phrase in the accent color) sits over this, left-aligned, with a shorter supporting line beneath it.
- Two CTAs side by side: one solid pill (primary accent, filled) and one outline pill (transparent, bordered) — never two solid buttons competing next to each other.
- A single bold iconic graphic anchors the right side of the hero (see Section 4).

**Full Circle equivalent:** the floating word-bubbles become floating scripture words or verse fragments in different translations/languages drifting in the background of the landing hero — this is a near-perfect conceptual match already, since Full Circle also deals in verses across versions the same way PARROT deals in greetings across languages.

## 9. Navigation Bar

Transparent-on-dark, wordmark + small icon on the left, plain text nav links centered-right, one solid CTA pill button on the far right. Inside the logged-in app, the nav simplifies further — just the wordmark, the person's name, and a utility action ("Start over") — no marketing nav links once someone's inside the product. Full Circle's cadet/sentry/admin dashboards should follow this same split: marketing site keeps the full nav, logged-in dashboards strip down to wordmark + identity + one or two utility actions.

## 10. Motion

Nothing aggressive — no bouncing, no large-scale parallax. The only motion visible in these screenshots is implied by the floating word-bubbles (subtle ambient drift) and standard page-transition loading. Keep Full Circle's motion in the same register: the lamp-flicker and card-rise animations already built into the cadet dashboard are the right *amount* of motion for this brand — playful in small doses, never showy.

---

## Summary: what to actually change when the reskin happens

Everything in Sections 3–10 above should carry over structurally as-is. The only genuine "swap" step is Section 2 — replacing PARROT's espresso/orange/gold triplet with Full Circle's own base/surface/two-accent set (e.g. ink base, ink-raised surface, brass as Accent 1, and a second accent — moss or a deeper gold — as Accent 2) — while keeping the same *rules* about where each color is allowed to appear (translucent badge tints, single-accent CTAs, left-border list states, one accent word in a headline).

---

## 11. The Ancient Culture Motif System

This replaces PARROT's mascot and its single visual "voice" with something layered — Full Circle draws on four ancient visual languages, each doing a different job. The structural skeleton from Sections 3–10 doesn't change; this is the ornamental layer sitting on top of it.

### The dove — Holy Spirit, the Guide
The dove takes the role PARROT's mascot held (nav mark, hero anchor, loading-screen centerpiece), redrawn in the same bold, single-silhouette, iconic treatment — but its job is broader than branding. It's the presence that *leads* someone through the app:
- Nav bar mark and hero graphic, as PARROT's mascot was
- The loading/transition screen centerpiece (Section 7) — the dove "brings you into" the next moment rather than a generic spinner
- A recurring figure on empty states and first-time onboarding moments — the dove is what a cadet, sentry, or instructor meets before there's anything else on the screen yet
- Its pose should read as descending/guiding (echoing PARROT's directional chevron-and-pointer shape) rather than static — motion implying "come, follow," not just a logo

### Zone mapping — each ancient pattern language has a home
| Motif | Primary zone | Why |
|---|---|---|
| **Hebrew & Aramaic** (square-script letterforms, scroll/edge motifs) | Scripture-facing surfaces — narrative/meditation cards, verse boxes, the landing hero's ornamental border | closest to the text itself; the "core" visual language |
| **Roman** (laurel wreath, meander/key border) | Recognition surfaces — Streakboard/Leaderboard rank badges, Awards Hub, medal elements | already aligned with "The Laureats" tent house |
| **Babylonian** (cuneiform wedge texture, ziggurat step-motif borders) | Economy surfaces — denarii displays, daily game reward panels, relic inventory | earliest coined-value/ledger-keeping cultures; fits the "economy" zone specifically |
| **Egyptian** (illustrative doodles, not texture: hieroglyph-style marks, a bend of the Nile, reeds, a palm tree, a pyramid on the horizon) | Story-triggered illustration — loading screens, section dividers, empty states, onboarding, or specifically when a reading is set in Egypt/the Exodus | this is narrative illustration, not a card skin or border treatment — it shows up because the story calls for it, not on a schedule |

### The rotation rule
Hebrew/Aramaic, Roman, and Babylonian motifs should **not stay permanently confined to their home zones** — each should periodically surface elsewhere in the app so the whole experience feels like one continuous visual world telling one story (the journey of God's people across empires), rather than three unrelated skins stitched together by section. In practice: a Roman laurel accent might appear in a scripture card during a week whose reading touches Rome; a Babylonian wedge-motif divider might appear in a non-economy context during an exile-themed reading week; a Hebrew scroll-edge might frame a Roman-zone award card during a ceremonial moment. This rotation should feel *tied to content* (which empire the current reading engages with) rather than random or decorative-only — the visual language moving through history alongside the reading is the point. Egyptian stays the one exception, appearing only where the story itself is set there, never rotated in as a generic accent.

