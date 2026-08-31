---
date: 2026-08-31
last_updated: 2026-08-31
purpose: The design contract for the two per-plant on-device tools — F38 "Ask about this plant" and F23 "Where to prune". This is what we build to and what we review against.
parent: Citrus Care PRD v1 §6
related: docs/research/pruning-rules.md · docs/research/on-device-vlm-native.md · CLAUDE.md (D-17 hard rules)
status: built, not yet verified on a device
sources:
  - docs/research/pruning-rules.md (extension services + RHS, adversarially fact-checked)
  - Gemma 4 model card / Hugging Face launch post (box_2d convention, E2B tier limits)
  - react-native-executorch 0.9.2 (installed API surface)
---

# Plant tools — design plan (F38 chat, F23 where-to-prune)

## 1. What these are

Two tools that act on **one plant** rather than on one photo, both running on the phone's existing
Gemma session:

| | F38 "Ask about this plant" | F23 "Where to prune" |
|---|---|---|
| Input | a typed question | a photo of the plant |
| Model call | text-only | image + JSON |
| Output | prose, ≤120 words | up to 3 marked regions + a step list |
| Grounded by | that plant's stored record | a sourced species rule pack + a season verdict |

They complete a loop the app already half-had: the assess flow judges a cut **after** it is made
(`subject: "cut"`); F23 says where to cut **before**; F38 answers the questions either raises.

## 2. The one idea both tools are built on

**The model is never the source of the horticulture.**

Everything that could hurt a plant if it were wrong is computed by code from sourced data:

- the species rule pack (`pruning-rules-packs.ts`) — extension-service + RHS rules, fact-checked;
- today's season verdict (`pruning-rules.ts`) — arithmetic over month arrays;
- the watering numbers, dates and trend the chat quotes — read from the on-device stores.

The model does two things only: **apply** those rules to what it can see, and **point** at where. When it
fails, the sourced half is still on screen and still correct. Every design decision below follows from
this one.

## 3. Locked decisions

**D-P1. The sentence is the instruction; the mark is an aid.**
Every cut carries `action` + `reason` text. A mark that lands on the wrong branch degrades to "a marker
in the wrong place next to correct advice", never to "cut here" pointing at the trunk. This has teeth in
the schema: `x`/`y` are **optional**, so a cut whose coordinates we refuse to trust keeps its advice and
simply appears in the step list with no badge and an explicit "not marked on the photo — find this one
from the description". Losing a coordinate must never delete correct guidance.

**D-P2. Ask the model for `box_2d` in its trained convention.**
`[y_min, x_min, y_max, x_max]`, integers on a 1000-grid, **y first**. That is what Gemma 4 was trained to
emit; percentages and 0–1 floats are off-distribution. The parser still accepts a bare `x`/`y` point in
0–100, 0–1 or 0–1000 for a model that ignores the format, and normalizes everything to percentages of the
photo before it reaches the schema, so the app never thinks in two coordinate systems.

**D-P3. Regions, not crosshairs — and the arrow stops at the region's edge.**
At the E2B tier, localizing thin elongated structures against cluttered self-similar backgrounds is a
*documented* failure mode. The box is drawn at its real size as a dashed halo — its area is the only
uncertainty signal available, and a crosshair would discard it and claim precision this tier lacks.

The numbered arrow the feature was asked for stays, but its head stops at the halo's **boundary**, never
at a pixel inside it (`placeMark`, tested). An arrowhead landing on the centre is a crosshair with better
aim, and it wins the squint test against the very halo that is supposed to carry the doubt. Pointing at
the region says "the branch is in here" — the strongest claim this tier supports.

**D-P4. A mark we cannot trust is not drawn — the mark, not the cut.**
The marker is dropped (the cut survives, per D-P1) when coordinates are out of range, the box is
inverted, the box covers more than 55% of the photo (the documented "one huge box over a quadrant"
failure), or the box is under 0.05% — all four values ≤ 100 is ambiguous between the 0–1000 grid and
percentages, and guessing produces a small, tight, confident-looking, wrong overlay, which is the one
outcome worth avoiding most. `MAX_CUTS = 3` holds the model to the three it was asked for; extra boxes
are guesses. When the model itself reports `subject: "unclear"` we believe it and draw nothing at all.
A plan with zero drawable marks still renders — the rules, the season and the text steps carry it.
*A missing overlay is a good outcome; a wrong one is not.*

**D-P5. Hemisphere is load-bearing, not a nicety.**
Every source behind every window is northern-hemisphere. Month arrays are stored northern and mirrored
six months for a southern caller (hemisphere read from the cached Open-Meteo geocode latitude, which never
expires even though the forecast does). Every verdict leads with the **condition** — "after your last
frost" — so the advice survives a grower we guessed wrong about. This was the single ship-blocking defect
the fact-check found, in four separate packs.

Mirroring covers the month *arrays* only. Rule **strings** still name northern months ("September through
January", "stop by about 1 August") and rewriting all of them as conditions is unfinished work, so a
southern grower is told so explicitly — on the rules card, and in the chat's system prompt.

**D-P6. The 3 Ds always win.**
Dead, damaged and diseased wood may come off in any month. No season verdict may read as "don't touch
it". Two exceptions ride in the rule text: frost-damaged citrus (wait for spring regrowth) and oaks in the
oak-wilt window.

**D-P7. Chat output is prose, so the sanitizer is the gate.**
The shared-Zod rule covers structured output; a chat answer has none. `sanitizeChatAnswer` unwraps fences,
cuts hallucinated turns, refuses a prompt echo and caps the length. A refused answer is an honest,
retryable error — never raw model text on screen.

**D-P8. The screen owns what is on screen; the store is best-effort behind it.**
Both chat messages are persisted best-effort: a failed write costs the transcript, never the answer. The
question is written *before* the model runs, mirroring the assess flow's "save the photo first".

**D-P9. One budget, one session — and every caller must be in it.**
`inference-budget.ts` holds the 25s slow hint and 120s interrupt ceiling for diagnosis, care profile, chat
and pruning alike. All four go through the provider's FIFO mutex; none may overlap.

The budget is not per-caller bookkeeping, it is what makes `interrupt()` safe. A request's clock starts
when it is **enqueued**, so with equal ceilings the earliest one always expires first — and the earliest
is always the one currently running, so an interrupt can only ever hit its own request. **One unbudgeted
caller breaks that**: it can hold the session past another request's ceiling and take the interrupt meant
for itself. `care-profile-io` was exactly that caller until 2026-08-31. The invariant is written on
`LocalEngineProvider.generate`; a new caller that skips the budget re-opens the bug.

**D-P10. Only "low" confidence is shown.**
A model asserting "high" about its own coordinates has no calibration behind it, so showing it would
manufacture confidence. Saying it is unsure is information. No percentages, ever.

**D-P11. A window we extrapolated may suggest, never forbid.**
Only four packs (citrus, rose, flowering shrub, generic woody) carry month windows taken straight from the
research. The other six split the research's deliberately-advisory "other classes" block by class, so
their months are our extrapolation — and the research is explicit that those must not be presented as
authoritative. `PruningPack.authoritative` marks the difference, and `seasonVerdict` downgrades a
non-authoritative "avoid" to an advisory line that points at the rules, which *are* sourced.

## 4. Module map

```
pure (vitest, never imports react-native/expo)      io / ui (untested by policy)
─────────────────────────────────────────────       ─────────────────────────────
inference-budget.ts   25s/120s, shared              plant-chat-io.ts   chat store wiring
chat-store.ts         conversation per plant        prune-io.ts        plan store + notice flag
plant-chat.ts         prompt · facts · sanitize     weather-io.ts      cached weather + hemisphere
                      · runPlantChatTurn
pruning-rules.ts      pack selection · season       PlantChatScreen.tsx
pruning-rules-packs.ts  the sourced rule data       PruneScreen.tsx
prune-plan.ts         prompt · parse · placement    PruneOverlay.tsx
prune-flow.ts         photo → model → stored plan   PlantToolsCard.tsx  (entry points)
prune-store.ts        plans + tick-off state
packages/shared/prune-schemas.ts   the Zod contract
```

Data: `citrus.plant-chat.v1`, `citrus.prune-plans.v1`, `citrus.prune-marks-notice.v1`. Both stores cascade
on plant delete. Plan photos live in the plant's existing photo directory (so the same cascade removes
them) but are **not** in the photo index — that index maps assessment ids, and a plan is not an assessment.

## 4b. Refinements from the `ux-designer` pass (2026-08-31)

The screens were then put through the project's `ux-designer` subagent
(`.claude/agents/ux-designer.md`). What it changed, beyond D-P3 above:

- **The chat shows the record instead of asserting it.** A collapsible "what it knows about <plant>"
  strip carries the health score, symptoms, watering numbers and the season rule. It makes the product's
  central claim checkable, gives the user something to audit an answer against, and means the screen still
  says something true when the model is unavailable — the same reason the pruning screen renders its
  sourced rules unconditionally.
- **Readiness is checked on entry, not at the end of the funnel.** Both screens embed the existing setup
  card; neither now walks a user to a photo before telling them the model isn't installed.
- **The pruning action moved into a fixed footer** with the wait inside the button and any failure beside
  it, so recovery is never a scroll away and the wait is filled by the sourced rules.
- **The season verdict says a word, not just a colour** (`RIGHT NOW · WAIT`), matching the health bands'
  colour-plus-word rule.
- **"Nothing marked" became a real state** rather than a bare photo with a hedge about marks that aren't
  there, and the per-row "not marked" note stopped repeating once per cut.
- **Keep-awake now covers inference**, not just the model download — a 25–120 s run against a 30 s screen
  timeout, with both hands full.
- **Failures bind to the question that caused them**, with the retry beside it. The previous fix (refill
  the composer *and* keep the bubble) let one tap send the same question twice and replayed an unanswered
  question into the next prompt.
- **Touch targets, live regions and speaker attribution** across both screens.

## 5. Deliberately not built

| Not built | Why |
|---|---|
| Draggable "is this the branch you meant?" marker | The research says phase it: ship the rules + a coarse region first, watch how often marks are accepted, tighten only if the accept rate earns it. |
| Folding the coordinate request into the diagnosis pass | It would slow every assessment for a feature the user did not ask for. Pruning is its own deliberate action. |
| Pruning plans in the backup | A plan *is* its annotated photo, and the v2 photo carrier is keyed to assessment ids. Restoring a plan onto a dead image is worse than not restoring it. **Chat conversations, by contrast, ARE in the backup** — the document went v2 → v3 to carry them, so an export now contains free text the user typed. v1/v2 files still import (the section simply parses as empty). |
| Token streaming in the chat | It touches the load-bearing engine boundary. The answer is capped at ~120 words, which is the cheaper latency fix. |
| A confidence percentage | No calibration data exists behind one. |

## 6. How we know it works

Automated (green as of 2026-08-31): mobile `tsc --noEmit`, **554** vitest tests, `arch-guard` (pure/`-io`
split + no backend/cloud imports), `expo export`.

Two of those tests exist specifically to guard decisions above, because a decision with no test is a
comment: every pack classifies all twelve months exactly once (D-P6's "an unclassified month reads as
permission"), and a southern-hemisphere round-trip on the mirror (D-P5) — the ship-blocker had zero
automated coverage until it was written.

Not yet done, and load-bearing: **a real build on a real phone with a real plant.** Gemma's mark quality
is unmeasured, exactly as the D-17 diagnosis quality was. Until then the honest claim is "built", not
"works". First device run should check, in order:

1. Chat answers use *this* plant's numbers (its interval, its score, its last watering) — not generic advice.
2. A pruning run on a rose and on a citrus produces marks that land on branches at all.
3. How often the 55%-area and inverted-box guards fire — if they fire constantly, the marks are not worth
   drawing and the feature falls back to rules + steps only.
4. Wall-clock for an image + JSON pass against the 25s hint and 120s ceiling.

### Known gaps, recorded rather than fixed

- **No retention policy for pruning plans.** Every run writes another JPEG into the plant's photo
  directory and another record into one AsyncStorage blob, with no cap. Fine at one plan per plant per
  season; revisit if a user runs it repeatedly.
- **A stored plan is re-rendered under today's rule pack**, not the one it was generated under.
  `ruleClass` is recorded but nothing reads it, so editing a pack silently rewrites the advice shown
  beside an old plan.
- **`droppedMarks` is returned by the flow and never read by the screen** — the only record of how often
  the D-P4 guards fire is a `console.error`, which answers device question 3 badly.
- **The keyword floor is the generic woody pack**, so ferns, orchids, bulbs, bamboo, palms and conifers
  get dormant-woody-tree windows. Wrong-but-conservative for most; genuinely wrong for Prunus, which the
  pack's own rule 8 then contradicts.
- **Rule strings still name northern months.** Mirroring covers the arrays; rewriting every rule as a
  condition is the remaining work. A southern grower is told so on the rules card and in the chat prompt,
  which converts a silent wrong default into a stated assumption — not into a right answer.
