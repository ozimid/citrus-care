---
date: 2026-08-31
last_updated: 2026-08-31
purpose: Late-2026 competitive refresh — what moved since the June landscape, per-competitor deltas with threat levels, and which stolen ideas are zero-backend-compatible vs server-bound.
status: complete
sources: Apple App Store, PictureThis/Glority FAQ, PrivacyReview, GoldPenguin, IdentifyThis, ComplaintsBoard, Planta (getplanta.com), PlantIn (myplantin.com), Trustpilot, Uptodown, Soft112, AIToolGiant, Growli (getgrowli.app), BotanAI (botanai.app), Pl@ntNet, iNaturalist, Unstar, PlantAssistant, AccessNewswire, Google Play policy, PetaPixel, AIChief, FloraLens, TechBullion
---

# Competitive refresh — August 2026

Reference doc. Facts carry URLs; judgments are mine. Everything here is judged against D-17: no backend, no accounts, no telemetry, solo dev, Gemma quality still unmeasured (F32 unbuilt).

## What changed in the market since June

- **LLM chat is now table stakes.** PictureThis added GPT-4 chat (capped at 10 msgs/day even on premium), Blossom has an "AI Botanist," Growli launched with persistent memory chat ([aitoolgiant](https://www.aitoolgiant.com/reviews/best-ai-plant-care-apps-2026.html), [Growli](https://apps.apple.com/us/app/growli-plant-garden-care/id6759293623)). F38 per-plant chat is no longer unique — its differentiator is grounding in the local record, not chat itself.
- **The offline/private wedge is contested.** BotanAI markets "the only plant identifier that works offline" — on-device, 90k+ species, 500+ diseases, no account, no tracking, free ([botanai.app](https://www.botanai.app/)); PlantFocus PR pushes "offline + no subscription" as a wedge ([accessnewswire](https://www.accessnewswire.com/newsroom/en/business-and-professional-services/plantfocus-app-review-2026-dont-try-plant-focus-app-before-readi-1158177)). "On-device" alone is no longer a claim; **on-device DIAGNOSIS + care** still is — no consumer app runs diagnosis/care generation locally ([plantnet.org](https://plantnet.org/en/2022/10/18/plntnet-offline-embedded-identify-plants-anywhere-without-connection/), [inaturalist](https://www.inaturalist.org/blog/23075-real-time-computer-vision-predictions-in-seek-by-inaturalist-version-2-0)).
- **The retention bar rose.** Growli ships weather-timed daily briefings and night-before frost/heat alerts naming which plants to bring in; Greg adjusts watering from leaf turgidity/soil darkness photos; Planta's 30+-parameter scheduler remains the reference ([getgrowli.app](https://www.getgrowli.app/), [aitoolgiant](https://www.aitoolgiant.com/reviews/best-ai-plant-care-apps-2026.html), [getplanta.com](https://getplanta.com/)).
- **One-shot photo diagnosis is publicly named the weak baseline.** Yellow leaves match ~5 causes; apps that ask soil/watering/repot follow-ups "beat one-shot photo guessing"; Pl@ntNet's ranked, honest confidence is praised while single-confident-answer apps get roasted ([getgrowli.app blog](https://www.getgrowli.app/blog/whats-wrong-with-my-plant-app)).
- **Subscription rage is the category's loudest complaint.** $30–45/yr norms, trials auto-charging, cancellation flows that fail, billing after cancellation ([unstar](https://unstar.app/blog/plant-identification-apps-ranked-picturethis-plantin-plantnet-2026), [Trustpilot/PlantIn](https://www.trustpilot.com/review/myplantin.com), [ComplaintsBoard/PictureThis](https://www.complaintsboard.com/picturethis-plant-identifier-b149857)). This is documented ammunition, not speculation.
- **Play policy tightened** (July 15, 2026): User Data rules explicitly cover third-party AI integrations; AI-chat-central apps are scoped into the AI-Generated Content policy ([Google](https://support.google.com/googleplay/android-developer/answer/17134731)). Relevant when the Play launch happens; sideloading dodges it today.

## Competitor deltas

### PictureThis (Glority) — threat: HIGH
- Polish mode, not feature mode (v5.70.1, generic changelogs); 4.8★ / 1.1M ratings, Editors' Choice ([App Store](https://apps.apple.com/us/app/picturethis-plant-identifier/id1252497129)).
- Expanded into a general nature-ID suite: weeds, toxic species, trees, insects, birds, 360°/AR sweep scan (premium) ([aichief](https://aichief.com/ai-lifestyle-tools/picturethis/), [petapixel](https://petapixel.com/picturethis-best-plant-identifier-app/)).
- Human botanist escalation within 24h on bad diagnoses (premium) ([FAQ](https://www.picturethisai.com/faq)).
- Weaknesses, all documented: server-only AI ("requires a network connection"), Privacy Grade C, 4 trackers / 249 tracking attempts, ToS takes a worldwide license to user photos, $39.99 trial-trap complaints, 42% real-world ID accuracy vs ">98%" claim ([FAQ](https://www.picturethisai.com/faq), [privacyreview](https://privacyreview.co/picturethis), [goldpenguin](https://goldpenguin.org/tools/picturethis/), [identifythis](https://identifythis.app/picture-this-app-review), [complaintsboard](https://www.complaintsboard.com/picturethis-plant-identifier-b149857)).

### Planta — threat: HIGH (retention machinery)
- 4.8★ / ~113K ratings, Editors' Choice, near-continuous releases; ~$35.99/yr ([App Store](https://apps.apple.com/us/app/planta-plant-garden-care/id1410126781)).
- Core engine: 30+-parameter weather/climate watering scheduler + seasonal task types driving push cadence year-round; light meter, Dr. Planta, Care Share ([getplanta.com](https://getplanta.com/)).
- Weakness: most-restricted free tier in the category; features keep migrating behind the paywall ([floralens](https://floralens-app.com/en/alternatives/planta-alternatives)). No gamification — retention is the task queue ([techbullion](https://techbullion.com/best-plant-app-comparison-letplant-vs-planta/)).

### PlantIn — threat: MEDIUM
- 4.6★ / 228K ratings; added lawn care, multi-disease detection, offline mushroom ID, weather alerts ([App Store](https://apps.apple.com/us/app/plantin-plant-identifier-care/id1527399597)).
- Steep pricing ladder incl. $6.99–17.99/WEEK + ~$20/question botanist consults on top of premium; Trustpilot documents billing-after-cancellation, instant trial charges, "identified every plant as sick," and one harmful-advice case ([myplantin.com](https://myplantin.com/), [Trustpilot](https://www.trustpilot.com/review/myplantin.com)).

### Greg — threat: MEDIUM
- Active on Android (1.6.2.0, Jul 2026) ([uptodown](https://greg.en.uptodown.com/android)); pivoting to commerce (shop reviews, $5 unboxing credits) ([soft112](https://greg-plant-care-made-simple-ios.soft112.com/)).
- PlantVision measures pot size + window distance at scan; "Greg AI" adjusts watering from leaf turgidity/soil darkness photos; $39.99/yr; claims no personal-data sale ([aitoolgiant](https://www.aitoolgiant.com/reviews/best-ai-plant-care-apps-2026.html)).

### Blossom — threat: LOW-MEDIUM
- 4.6★ / 69K ratings; AI Botanist chat, weather alerts, pot-size water calculator, up to ~$79.99/yr; privacy label admits precise location + identifiers collected for advertising ([App Store](https://apps.apple.com/us/app/blossom-ai-plant-identifier/id1487453649)).

### Growli (new entrant, Feb 2026) — threat: MEDIUM-HIGH (closest playbook)
- Persistent-memory chat, weather-timed daily briefings, night-before frost/heat alerts naming plants to protect; $44.99/yr; account-based/cloud but markets no data sharing ([App Store](https://apps.apple.com/us/app/growli-plant-garden-care/id6759293623), [getgrowli.app](https://www.getgrowli.app/)). Its blog is also the sharpest public critique of one-shot photo diagnosis.

### BotanAI (new entrant) — threat: HIGH (wedge attack)
- Attacks Citrus Care's exact positioning: offline on-device ID (90k+ species claim), 500+ diseases, sub-second, no account, no tracking, free forever, weather-based watering skips ([botanai.app](https://www.botanai.app/)). Beats Citrus Care on species ID, speed, friction, and store distribution. It does NOT claim on-device generative diagnosis/care or longitudinal trends — that is the remaining defensible ground.

### Seek / Pl@ntNet — threat: MEDIUM (own the offline-ID story)
- Seek: real-time on-device CV ID, no account, no data collection ([inaturalist](https://www.inaturalist.org/blog/23075-real-time-computer-vision-predictions-in-seek-by-inaturalist-version-2-0)). Pl@ntNet: downloadable embedded model, "few percent" accuracy loss, plus a new observations log — still no care, reminders, or diagnosis ([plantnet.org](https://plantnet.org/en/2022/10/18/plntnet-offline-embedded-identify-plants-anywhere-without-connection/), [aitoolgiant](https://www.aitoolgiant.com/reviews/best-ai-plant-care-apps-2026.html)).

## Ideas worth stealing (zero-backend-compatible)

1. **Ranked differential diagnosis** (Pl@ntNet honesty) — top 2–3 candidate causes with confidence instead of one confident answer. Prompt + shared-Zod-schema change in `spike-vlm.ts` + UI; the tolerant extractor already handles it. Pairs with the honest-error philosophy.
2. **Triage pre-answered from the plant's own record** (Growli's follow-up questions, done better) — inject the local watering log, weather history, and timeline into the diagnosis prompt so overwatering/underwatering/light-stress ambiguity is resolved with zero user friction. A longitudinal advantage no cloud one-shot app has. Pure client logic.
3. **Night-before frost/heat "protect YOUR plants" alerts** (Growli) — cross Open-Meteo forecast with the local plant list deterministically → local notification. Disproportionately valuable for citrus; competitors paywall it.
4. **Weather-adjusted watering deltas** (BotanAI/Blossom) — "skip today, it rained 12mm" as a pure rule module extending existing weather-aware watering; vitest-testable.
5. **Deterministic "Today" / seasonal task queue** (Planta's core) — season engine + care profile + prune windows + weather → per-plant monthly tasks (fertilize, repot, frost-protect) and notification cadence. Zero-AI retention loop.
6. **Subscription-rage + privacy positioning** (copy, not code) — "No subscription. No trial. No account. Nothing leaves your phone." plus a factual, sourced side-by-side against PictureThis's trackers/photo-license ToS. Landing copy only; BMC makes it verifiable.
7. **Snap-time context capture** (Greg PlantVision) — 2-tap pot size / window distance / orientation wizard, or Gemma estimating from the photo, folded into diagnosis + care-profile prompts.
8. **Per-plant chat memory digest** (Growli) — compact Gemma-summarized digest of past Q&A stored in AsyncStorage, injected into future F38 chats. Constraint is context window: digest, not transcripts.
9. **Toxicity warnings (pets/kids)** — static per-species data pack, same pattern as F23 rule packs.
10. **Light meter** — ambient light sensor vs per-species lux table, on-device; undercuts a paywalled feature in both Planta and PictureThis.
11. **Batch "garden walkthrough" onboarding** (their 360 scan, honest framing) — N quick photos queued through the FIFO session, each drafting a plant entry. Not live AR (latency ceiling forbids it).
12. **Tiny bundled species classifier** (Seek pattern) — <120MB offline ID model for instant first-session value before the 1.3GB download. Fits the letter of D-17; adds a second model artifact. Spike only, gated on F32 results.
13. **Plant-sitter card** (Care Share analog) — self-contained HTML/PDF per plant the user shares themselves. One-way, no sync.

## Ideas that need a server (recorded, not planned)

- **Human expert escalation** (PictureThis 24h botanist, PlantIn $20 consults) — humans + server + accounts + photo upload. Violates D-17. Local analog: low-confidence → deepen grounded Q&A + deterministic link-outs to the user's county extension service. Signal: users pay above tip-jar prices for resolution.
- **Care Share** (Planta) — account-based sync. Analog: the offline plant-sitter card above.
- **Community feeds / shop-review flywheel** (Greg, PictureThis) — accounts, moderation, commerce. Analog: shareable artifacts (diagnosis cards, before/after recovery images) users post to existing communities (r/Citrus).
- **Community-calibrated care** (Greg's aggregate watering tuning) — server-side aggregation + telemetry. Analog is what already ships: Open-Meteo + extension-service rule packs; extendable with richer static climate/species tables only.
- **Cross-device sync / web portal** (PlantIn) — accounts by definition. Manual JSON backup is the analog.
- *(Not server-bound but infeasible anyway:)* **live AR viewfinder ID** — Gemma's 25s hint / 120s ceiling cannot do real-time inference; only the batch walkthrough framing is honest.

## Sources

- Apple App Store listings: [PictureThis](https://apps.apple.com/us/app/picturethis-plant-identifier/id1252497129) · [Planta](https://apps.apple.com/us/app/planta-plant-garden-care/id1410126781) · [PlantIn](https://apps.apple.com/us/app/plantin-plant-identifier-care/id1527399597) · [Blossom](https://apps.apple.com/us/app/blossom-ai-plant-identifier/id1487453649) · [Growli](https://apps.apple.com/us/app/growli-plant-garden-care/id6759293623)
- Vendor sites/FAQs: [picturethisai.com/faq](https://www.picturethisai.com/faq) · [getplanta.com](https://getplanta.com/) · [myplantin.com](https://myplantin.com/) · [getgrowli.app](https://www.getgrowli.app/) · [botanai.app](https://www.botanai.app/) · [plantnet.org](https://plantnet.org/en/2022/10/18/plntnet-offline-embedded-identify-plants-anywhere-without-connection/) · [inaturalist.org](https://www.inaturalist.org/blog/23075-real-time-computer-vision-predictions-in-seek-by-inaturalist-version-2-0)
- Reviews/audits/complaints: [privacyreview.co](https://privacyreview.co/picturethis) · [goldpenguin.org](https://goldpenguin.org/tools/picturethis/) · [identifythis.app](https://identifythis.app/picture-this-app-review) · [complaintsboard.com](https://www.complaintsboard.com/picturethis-plant-identifier-b149857) · [trustpilot.com/myplantin](https://www.trustpilot.com/review/myplantin.com) · [aitoolgiant.com](https://www.aitoolgiant.com/reviews/best-ai-plant-care-apps-2026.html) · [petapixel.com](https://petapixel.com/picturethis-best-plant-identifier-app/) · [aichief.com](https://aichief.com/ai-lifestyle-tools/picturethis/) · [floralens-app.com](https://floralens-app.com/en/alternatives/planta-alternatives) · [techbullion.com](https://techbullion.com/best-plant-app-comparison-letplant-vs-planta/) · [unstar.app](https://unstar.app/blog/plant-identification-apps-ranked-picturethis-plantin-plantnet-2026) · [getgrowli.app blog](https://www.getgrowli.app/blog/whats-wrong-with-my-plant-app)
- Other: [uptodown (Greg Android)](https://greg.en.uptodown.com/android) · [soft112 (Greg iOS changelog)](https://greg-plant-care-made-simple-ios.soft112.com/) · [plantassistant.net/terms](https://plantassistant.net/terms/) · [accessnewswire (PlantFocus PR)](https://www.accessnewswire.com/newsroom/en/business-and-professional-services/plantfocus-app-review-2026-dont-try-plant-focus-app-before-readi-1158177) · [Google Play policy](https://support.google.com/googleplay/android-developer/answer/17134731)
