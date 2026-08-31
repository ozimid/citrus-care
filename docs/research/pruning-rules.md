---
date: 2026-08-31
last_updated: 2026-08-31
purpose: Fact-checked, ship-ready pruning rule packs (citrus, rose, flowering, universal, other classes) plus the on-device VLM grounding limits that constrain how the app may display them.
status: complete
sources:
  - UC Statewide IPM Program (UC ANR)
  - UC Cooperative Extension, Placer & Nevada Counties
  - UC Master Gardeners (Sacramento, Santa Clara, Marin, Contra Costa, Napa, Fresno)
  - UC ANR Environmental Health & Safety
  - Texas A&M AgriLife Extension (Aggie Horticulture, Galveston, Extension Plant Pathology)
  - University of Florida IFAS Extension (EDIS, Environmental Horticulture, Duval County)
  - Clemson Cooperative Extension, Home & Garden Information Center
  - University of Illinois Extension
  - Iowa State University Extension and Outreach
  - University of Minnesota Extension
  - Penn State Extension
  - University of Missouri Extension
  - University of Georgia Extension
  - University of Arizona Cooperative Extension
  - Oregon State University Extension Service
  - Missouri Botanical Garden
  - Royal Horticultural Society
  - Google / Gemma model card and vision documentation
  - Hugging Face (Gemma 4 launch post, model repos)
  - Software Mansion (react-native-executorch docs, benchmarks, issue tracker)
  - arXiv (PaliGemma, Molmo/PixMo, MolmoPoint, vehicle-damage grounding)
---

# Pruning rules — fact-checked packs for Citrus Care

Five rule packs, each researched against extension-service and RHS primary sources, then run through an
adversarial fact-check. Every correction the checker demanded has been applied below; nothing it flagged
as unsafe ships in its original form. Rule strings are ≤140 characters and imperative so they can be
pasted verbatim into an on-device prompt and into UI copy.

## Bottom line

**What the app may safely claim**

- The *horticultural rule itself* is deterministic and defensible: which wood carries the flowers, where
  the cut goes relative to the collar or the bud, how much of a plant may come off at once, and which
  months are wrong. Every rule below traces to a named extension service or the RHS.
- Season windows may be shown **as Northern-Hemisphere defaults with the hemisphere stated**, or resolved
  from the user's location. The app already does anonymous Open-Meteo lookups, so latitude is available.
- Text guidance is load-bearing and always correct: *"cut just above an outward-facing bud, about 1/4 in
  (6 mm) above it, sloping away"* holds regardless of what any model thinks it sees in the photo.
- The 3 Ds pass (dead, diseased, damaged) is the one instruction that is nearly always safe — with two
  documented exceptions, oaks in the oak-wilt window and frost-damaged tender evergreens.

**What the app must not claim**

- **Never render bare month numbers without a hemisphere check.** Every source behind every pack is
  Northern Hemisphere. Shipped raw to a Sydney or Auckland user, four of the five packs invert by six
  months and instruct exactly the frost-damage failure they exist to prevent. This was the single
  ship-blocking defect the fact-check found, in *four separate packs*.
- **Never draw a precise "cut here" arrow from model coordinates.** Gemma 4 E2B can emit boxes, but at
  this scale localization of thin elongated structures against cluttered self-similar backgrounds is a
  documented failure mode. Region hint + draggable marker, never a crosshair. See
  [On-device VLM grounding](#on-device-vlm-grounding).
- **Never state a confidence percentage.** There is no calibration data behind one; a fabricated number
  is worse than none.
- Never present the season arrays for `other_classes` as authoritative — that pack blends five unrelated
  plant classes and its months are advisory only.

---

## Rule packs

Months are integers 1–12, **Northern Hemisphere**. For the Southern Hemisphere, shift every month by six
(`((m + 5) % 12) + 1`) or resolve the window phenologically from the user's frost dates.

### Citrus

| Window | Months | Plain English |
|---|---|---|
| Best | 3, 4, 5 | March–May: after the last frost, before summer heat, just before bloom or just after fruit set |
| Acceptable | 2, 6, 7, 8 | February in mild zone 9+ once frost risk passes (and glasshouse/container citrus); June–August tolerated but sunburn-risky — light thinning and deadwood only |
| Avoid | 9, 10, 11, 12, 1 | September–January: no shaping or size-reduction, because a late flush meets frost |

Dead, diseased or damaged wood may come out any month (winter cuts kept under 1/2 in).

**Rules**

1. Prune after your last frost has passed and before summer heat, aiming just before bloom or just after fruit set.
2. Do no shaping or size-reduction cuts from September through January.
3. Rub or cut off any shoot below the graft union as soon as it appears, taking it right back to its base.
4. Cut water sprouts out at their base rather than heading them back; their fruit is often large, rough and dry-segmented.
5. On a freeze-damaged tree, keep the strongest well-placed sprouts above the graft union and train them to rebuild the canopy.
6. Cut out dead, damaged or diseased wood any month, but in winter keep cuts under 1/2 in (1.25 cm).
7. On established in-ground trees, remove foliage that rests on the soil so ants and snails cannot climb up.
8. Thin crossing branches and limbs shading lower wood until dappled sunlight reaches the ground at midday.
9. Remove at most a quarter of the canopy in one year on home and container citrus.
10. Cut height by at most a third at once, on large in-ground trees only, leaving well-foliaged branches to feed the tree.
11. Treat June-August cuts as light work only: thin and take deadwood, then whitewash every newly exposed limb.
12. Whitewash limbs and trunk newly exposed by pruning with 50:50 white interior latex paint and water.
13. Disinfect blades between trees and right after any diseased cut: 70% alcohol, or a bleach solution then rinse and oil.

**Never**

1. Never cut a branch flush with the trunk - cut just outside the raised branch collar.
2. Never seal citrus pruning cuts with wound paint, tar or sealer; whitewash against sunburn is a different thing.
3. Never cut freeze-damaged wood straight away - wait until regrowth shows the true limit of the injury, often May.
4. Never shear all the shoot tips off a potted citrus, and hard-prune no more than one branch a year.
5. Never skirt a young or container citrus - you strip fruiting canopy and expose thin bark to sunburn.
6. Never move citrus prunings, clippings or plants out of a psyllid, HLB or canker quarantine area.
7. Never prune citrus while the foliage is wet in canker country; bag and bury or burn infected prunings.

### Rose

| Window | Months | Plain English |
|---|---|---|
| Best | 2, 3 | February–March in most temperate gardens: dormant buds swelling, ~3–4 weeks before the average last killing frost |
| Acceptable | 1, 4, 5, 6, 7, 8, 12 | January in mild-winter areas (coastal California); April into mid-month where winters are hard; June–August for once-bloomers straight after flowering; December for climbers and mild-winter dormant work |
| Avoid | 9, 10, 11 | September–November: autumn regrowth cannot harden off. Warm-winter regions are the stated exception — a light quarter-to-third prune in late August to mid-September sets the autumn flush |

**Rules**

1. Hard-prune dormant bush roses as the buds swell, about 3-4 weeks before your average last killing frost.
2. Cut on a slight slant about 1/4 in (6 mm) above a bud, sloping away from it, and never nick the bud itself.
3. Cut to an outward-facing bud so the bush opens into a vase shape; use inward-facing buds only on spreading roses.
4. Keep 3-6 strong evenly spaced canes from last year's growth - 6-10 on a big mature bush - and cut the rest to the ground.
5. Cut back to live white or pale-green pith first; where dieback is light, finish near 12-18 in for hybrid teas and grandifloras.
6. Finish floribundas near 24-36 in; Clemson uses 15-18 in for all bush types and Texas A&M 12-24 in, so treat these as ranges.
7. Remove dead, brown-pithed, diseased, spindly and crossing canes, cutting back to white or pale-green pith.
8. On hybrid teas, grandifloras and floribundas, remove canes thinner than a pencil.
9. On miniature, polyantha, species and shrub roses, judge canes by health and vigour, not by diameter.
10. Prune shrub and landscape roses lightly: each spring take about a third of the oldest canes down to the base.
11. Train repeat-flowering climbers' main canes horizontally, then shorten each flowered side shoot to 3-6 in in spring.
12. Check the base for a swollen bud union first: with none the rose is own-root, and every basal shoot is a wanted cane.
13. On grafted roses only, trace a shoot from below the bud union down to the root and tear it away, rather than cutting it.
14. Deadhead repeat bloomers to the first outward-facing five-leaflet leaf, leaving two full leaves on weak plants.
15. In warm-winter regions, prune a quarter to a third in late August to mid-September to set up the autumn flush.
16. Dip blades in 70% isopropyl alcohol or 1:9 bleach before each plant and right after cutting diseased wood.

**Never**

1. In cold-winter zones never prune roses structurally in autumn; only shorten tall hybrid teas by a third against wind-rock.
2. Never hard-prune once-blooming roses, ramblers or spring-only climbers in late winter - prune right after they flower.
3. Never cut a sucker off at soil level or leave it stubbed - one cut sucker regrows as several.
4. Never carry sap between roses on unsterilised blades; pruners spread rose rosette virus, black spot and crown gall.
5. Never try to prune rose rosette out - it is systemic to the roots, so dig out and bag the whole plant.
6. Never use anvil pruners on roses - use sharp bypass pruners, loppers, or a saw for thick canes.
7. Never leave a stub: cut to a bud, to a lateral, or right down to the base.

### Flowering shrubs and perennials

| Window | Months | Plain English |
|---|---|---|
| Best | 3, 4, 5, 6 | March–June: the dormant/pre-budbreak window for new-wood bloomers, then the 2–3 weeks right after spring flowers fade for old-wood shrubs |
| Acceptable | 1, 2, 7 | January in warm zones (dormant, buds not yet swelling); February wherever dormancy holds; July for late-finishing bloomers and the last pinches |
| Avoid | 8, 9, 10, 11, 12 | August–December: buds for next spring are already set, late cuts force frost-tender growth, and standing stems feed birds and shelter stem-nesting bees |

**Rules**

1. Prune spring bloomers as the flowers fade; prune summer bloomers while dormant, before spring growth starts.
2. Prune lilac and forsythia within two weeks of bloom, and every few years take a third of the oldest stems to the ground.
3. Cut butterfly bush, panicle and smooth hydrangea, summersweet and summer spirea back while dormant, before new foliage.
4. Prune non-reblooming bigleaf hydrangea, mophead and lacecap alike, only right after bloom and stop by about 1 August.
5. Prune reblooming hydrangeas such as Endless Summer any time - they flower on both old and new wood.
6. Remove dead hydrangea canes whenever you find them; in cold regions wait for spring budbreak so live wood shows.
7. Leave faded bigleaf hydrangea heads over winter to shelter the buds below, then cut to the first strong pair in early spring.
8. Deadhead by cutting just above the next healthy leaves or buds; cut iris and hosta stalks down to the base.
9. On delphinium and lupin, pick off spent florets first, then cut the spike to a lower bud, a side shoot, or the ground.
10. Cut hardy geranium, delphinium, pulmonaria and catmint near the ground right after flowering, then water and feed.
11. Pinch out shoot tips early to force branching, staggering pinches over about three weeks for a longer bloom run.
12. Stop pinching mums by early July and asters by mid-to-late July, or you remove the buds and lose the autumn display.
13. Cut coneflower, sneezeweed, phlox, tall sedum and goldenrod back by a third to a half in late May or early June.
14. Leave seed heads standing over winter and cut back only once it is reliably warm, leaving 8-24 in stubs for nesting bees.
15. Lay the cut tops in a quiet corner for a few weeks rather than bagging or shredding them - insects are still inside.
16. Deadhead butterfly bush through summer to extend bloom and stop seed spread; where it is regulated, plant sterile cultivars.
17. In cold zones butterfly bush dies back and emerges late, so do not dig it up before early summer.
18. To renovate an overgrown old-wood shrub, cut every stem to 4-6 in in early spring and expect several bloomless seasons.
19. Remove dead, diseased, damaged or hazardous branches in any month - that is always the first cut.

**Never**

1. Never prune old-wood shrubs in late summer, autumn or winter, except to take out dead, diseased or damaged wood.
2. Never prune non-reblooming bigleaf hydrangea after 1 August; if you must cut live canes, take no more than a third.
3. Never prune shrubs in late autumn or midwinter beyond removing dead, diseased or damaged wood.
4. Never deadhead plants grown for seed heads or self-seeding: rudbeckia, cornflower, sunflower, honesty, species roses.
5. Never take more than half a perennial's foliage at once, unless it is an early perennial cut back right after flowering.
6. Never cut penstemon or other borderline-hardy perennials down in autumn - wait until your local last frost has passed.

### Universal (any woody plant)

| Window | Months | Plain English |
|---|---|---|
| Best | 2, 3 | Late dormancy: coldest weather past, buds not yet breaking. Wounds close fast, deadwood is obvious, most pests are inactive |
| Acceptable | 1, 4, 5, 6, 7, 11, 12 | January and November–December where dormancy holds; April–July for Prunus, for old-wood bloomers after they flower, and for light growing-season work — but **not oaks** where oak wilt occurs |
| Avoid | 8, 9, 10 | August–October: within roughly ten weeks of the first hard frost, so cuts force soft growth that freezes |

The one winter pathogen that matters is silver leaf, whose spores peak in damp autumn and winter air —
which is exactly why Prunus is pruned in summer instead.

**Rules**

1. Find the branch bark ridge and collar: start the cut just outside the ridge and finish just outside the collar swelling.
2. On limbs over 1.5 in (4 cm) use three cuts: undercut a third, cut through further out, then make the final collar cut.
3. Shorten a shoot on a slight slant about 1/4 in (6 mm) above a healthy bud, sloping away from it.
4. Cut to a bud facing the way you want the new growth to go - outward to open a congested plant, inward to fill a gap.
5. Take no more than 20-25% off a young or shrubby plant in one go, and no more than 10% of live foliage off a mature tree.
6. Take no live foliage at all from a stressed tree.
7. Make dead, diseased and damaged wood your first pass, then crossing or rubbing stems.
8. Cut the 3 Ds in any month, except oaks in April-July and frost-damaged tender plants before spring growth appears.
9. Wait for spring growth before cutting frost-damaged citrus and other tender evergreens - dead wood insulates live tissue.
10. Prune plum, cherry, apricot, peach and ornamental Prunus in late spring to midsummer, never in the dormant window.
11. Where oak wilt occurs, prune oaks only November-March, and paint any unavoidable April-July wound immediately.
12. Stop major pruning about ten weeks before your area's first hard frost.
13. Use sharp, clean blades and the right tool for the branch size; never force a cut bigger than the tool is built for.
14. Disinfect between plants: dip about two minutes in 1 part bleach to 9 parts water and let it dry, or wipe with 70% alcohol.
15. Clean soil off blades first because it neutralises bleach, then wipe dry and oil, because bleach corrodes steel.
16. Seal a cut only in three cases: oak wounds in oak wilt season, plums and cherries against silver leaf, sunburn whitewash.
17. Wear safety glasses with side shields, gloves, a hard hat, long sleeves, long trousers and boots.
18. On a stepladder: solid level ground, spreaders locked, face the ladder, and never step above the top two rungs.
19. Hand chainsaw work, ladder work and overhead work to an ISA-certified arborist working to ANSI A300.

**Never**

1. Never cut a branch off flush with the trunk.
2. Never leave a stub past the collar, or more than about 1/4 in (6 mm) above a bud.
3. Never take a heavy limb off with a single cut from above - it tears loose and strips bark down the trunk.
4. Never top a tree: stubbing main limbs back starves it, lets decay into the trunk and forces weak watersprouts.
5. Never routinely seal or tar a pruning wound to speed healing - dressings do not prevent decay and can trap it.
6. Never prune trees or branches within 10 feet of power lines - call your utility and use line-clearance crews.
7. Never do major pruning in late summer or early autumn - it forces soft growth that freezing weather kills.
8. Never prune oaks April-July where oak wilt occurs, deadwood included, unless the limb is a safety hazard.
9. Never prune Prunus in winter - damp winter air carries the silver leaf spores that kill branches.

### Other classes (succulents/cacti, herbs, vegetables, vines, houseplants)

**Advisory months only.** This pack blends five unrelated classes whose windows genuinely differ; the
per-class rules govern. `avoid_months` is deliberately empty — the fact-check dismantled the original
October–November block using the pack's own sources.

| Window | Months | Plain English |
|---|---|---|
| Best | 3, 4, 5, 6, 7, 8 | Active growth: houseplants and succulents as growth restarts, herbs and vegetables through the season, wisteria's summer cut in July–August |
| Acceptable | 1, 2, 9, 10, 11, 12 | Dormant vine work (late Nov–Dec in mild winters, Feb–early Mar in zone 6 and colder), wisteria's Jan–Feb spur cut, and succulent/cactus cuttings while nights hold above 60 °F (16 °C), roughly to October |
| Avoid | — | No month is off-limits across all five classes; use the class rules and the never list |

**Rules**

1. Most cacti and succulents need no pruning; shorten a leggy branching succulent just above a leaf node so it rebranches.
2. Take Opuntia pads at the joint and offsets with a short stub of connecting stem - cut too close and no roots will form.
3. Cut a columnar cactus at 45 degrees so water sheds off the parent's wound, and square off the base of a piece you will root.
4. Cut basil and soft herbs just above a pair of good-sized leaves, and pinch off flower spikes as they appear.
5. Leave Thai basil's purple flowers on; only the leaf-crop basils need every flower spike pinched out.
6. Trim lavender and rosemary lightly once a year after the flowers fade: spent stalks plus about 1 in (2.5 cm) of leafy growth.
7. Prune sage in spring as new growth resumes, and trim it again through the season to keep it from going leggy.
8. Pinch suckers out of indeterminate tomatoes while small, and at planting remove lower stems touching the soil.
9. Once tomatoes reach about 24 in, strip leaves from the bottom 12 in, or up to the first flowers, whichever comes first.
10. Top peppers at 12 in down to the second leaf set, but bottom-prune super-hot peppers only 6-8 in.
11. Prune grapes fully dormant and before budbreak, taking off 80-90% of last season's growth as 2-4 bud spurs or long canes.
12. Prune grapes late November to December in mild winters; in zone 6 and colder wait until February or early March.
13. Prune wisteria twice: shorten whippy shoots to 5-6 leaves in July or August, then to 2-3 fat buds in January or February.
14. Cut foliage houseplants just above a leaf or growth bud to force branching; pinching a soft tip branches it just below.
15. Take dead, yellow or leggy houseplant growth off with sanitized snips, sanitizing between plants to limit disease spread.
16. Save heavy cutting back of houseplants for late winter, before the spring growth flush.

**Never**

1. Never plant a fresh cactus or succulent cut, pad or offset straight into soil - air-dry it until the wound calluses.
2. Never judge callusing by the clock: 24-48 h for small cuttings, days to weeks for pads, up to months for thick stems.
3. Never cut lavender, rosemary, thyme or basil back into bare old wood - they rarely break new growth from it.
4. In zone 6 and colder, never cut lavender, rosemary or sage back in autumn - wait for new growth in spring.
5. Never remove suckers from a determinate bush tomato - bottom-pruning is the only pruning it gets.
6. Never thin tomato or pepper foliage so hard that the fruit is left sitting in full sun and scalds.
7. Never shorten the whole framework of a spring-flowering vine in late winter; established wisteria spurs are the exception.
8. Never take more than a third off a woody ornamental shrub or tree at once - dormant grape, wisteria and pepper cuts aside.

---

## Fact-check corrections applied

Two packs (citrus, rose) came back **unsafe**; three (flowering, universal, other classes) came back
**needs_correction**. Nothing flagged has shipped in its original form.

| Pack | Original claim | Defect | Correction applied |
|---|---|---|---|
| citrus | Bare months 3–5 best / 8–1 avoid | Hemisphere-confused; all 14 sources are NH | Months stamped **Northern Hemisphere, USDA 8b–11**; SH mirror documented; window also stated phenologically (after last frost, before summer heat) |
| citrus | August in `avoid_months`, cited to TAMU Galveston | Misattributed — the Galveston sentence is about *fertilizer*, and Sacramento GN 127 explicitly permits August | Moved 8 to `acceptable_months`; Galveston clause deleted from the note |
| citrus | Skirt to 18–24 in, "in a pot as well as in the ground" | Orchard/food-safety practice mis-applied; UC IPM's default is a *full skirt*; nothing supports container citrus | Softened to "remove foliage that rests on the soil", restricted to established in-ground trees; new never-rule forbids skirting young/potted trees |
| citrus | Quarter of canopy **and** third of height in one rule | Internally contradictory, two scales fused | Quarter-canopy is the binding annual cap; third-of-height demoted to a separate ceiling for large in-ground trees, carrying Placer's "can kill the tree"/leave-foliage conditions |
| citrus | Remove all water sprouts unconditionally | Collides with the freeze-recovery rule; source is hedged ("often poor quality") | Added the freeze/limb-loss exception as its own rule; restored the hedge; scoped to shoots *above* the graft union |
| citrus | June–July "acceptable" while rule 1 says "before summer heat" | Internally inconsistent; no sunburn caveat | Kept 6–8 as acceptable but added an explicit light-work + whitewash rule and the same caveat in the season note |
| citrus | "10% bleach … UF also lists Lysol and TSP", cited to a TAMU canker PDF | Citation does not support it; wrong publisher; no corrosion caveat | Lysol/TSP dropped; sanitiser rule reworded to 70% alcohol or bleach-then-rinse-and-oil |
| citrus | "February only for glasshouse/frost-free" | Over-restrictive; TAMU Galveston recommends late February outdoors | Rewritten: February is fine in mild zone 9+ once local frost risk passes, and for glasshouse/container citrus |
| rose | "Keep 3–6 **year-old** canes" | Misread OSU and inverted it — would keep exhausted wood and remove young basal canes | Restated as a **count** of last year's canes (3–6; 6–10 on a big mature bush) |
| rose | Months 2–3 best / 9–11 avoid | NH-only while the prose anchor (last killing frost) is hemisphere-neutral | Stamped NH with SH mirror; frost-relative anchor kept as the primary rule |
| rose | Blanket "never prune live canes in autumn", cited to Iowa State | Contradicted by Clemson, TAMU and OSU; source does not state the exception | Scoped to cold-winter zones; added a warm-winter rule (light quarter-to-third prune late Aug–mid Sep) |
| rose | "Remove canes thinner than a pencil" | Clemson scopes it to hybrid teas; applied literally it removes an entire miniature or species rose | Split into two rules: diameter test for HT/grandiflora/floribunda; health-and-vigour test for miniature, polyantha, species and shrub roses |
| rose | Sucker rules with no graft qualifier | Most modern landscape roses are own-root; excavating "suckers" destroys wanted basal canes | Added the bud-union check as the first step; tearing scoped to grafted roses only; "never cut" softened to prefer tearing |
| rose | December unclassified; January flagged plainly acceptable | Undefined state for a whole dormant-season month; climate qualifier lost from the array | All 12 months classified; December acceptable (climbers, mild winters); qualifiers carried in the season note |
| rose | 12–18 in / 24–36 in as universal finish heights | Mild-maritime numbers, source internally inconsistent, grandiflora missing | Subordinated to "cut to live white pith first"; heights presented as a range across OSU/Clemson/TAMU; grandiflora added |
| rose | Sanitising rule with no rose-rosette disposal step | Implies the disease can be pruned out | Added never-rule: rose rosette is systemic to the roots — dig out and bag the whole plant |
| flowering | Every month unqualified | NH-only across Clemson/PSU/Illinois/Iowa/UMN/RHS | Stamped NH (≈USDA 3–8 / UK temperate) with SH mirror; windows also stated as conditions |
| flowering | "Cut penstemon back in April or May" | RHS UK phenology; in the SH that *is* autumn, i.e. the lethal cut the rule forbids | Replaced with "wait until your local last frost has passed" |
| flowering | "Never prune bigleaf or lacecap hydrangea … or in spring" | Drops the rebloomer exception both sources state; blocks necessary spring deadwood removal; lacecap is a form, not a sibling species | Split into four rules: non-reblooming (after bloom, stop ~1 Aug), rebloomers (any time), dead canes (any time, spring in cold regions), and overwintered flowerheads (remove early spring) |
| flowering | "Never remove more than half a perennial's foliage" vs "cut hardy geraniums near the ground" | Direct self-contradiction; source states a stress caution, not a prohibition | Demoted to a default with the named exception (hardy geranium, delphinium, pulmonaria, catmint) |
| flowering | Pinching with no stop date | Mums/asters are short-day plants; late pinches destroy the autumn display | Added the cutoff rule: mums by early July, asters by mid-to-late July |
| flowering | Absolute "never prune old-wood shrubs / never prune in late autumn" | No carve-out for dead, diseased, damaged or hazardous wood | Carve-out written into both never-rules; renovation option (all stems to 4–6 in in early spring) added as a rule |
| flowering | "RHS instead deadheads … prefer the extension timing" | Source adjudication leaked into user copy; mischaracterises RHS | Why-text replaced with the plant's own reason; the RHS nuance became its own rule |
| flowering | "Late winter (Feb–Apr)" pinned to months | Window moves weeks by zone; January is correct in zone 8–9 but was flagged avoid | Stated as a condition (dormant, before buds swell); January moved to acceptable |
| flowering | Note says "2–6 weeks after bloom", rule says "within two weeks" | Note undercuts the stricter sourced rule | Harmonised to 2–3 weeks; lilac renewal cadence softened to "every few years" |
| flowering | Buddleia with no deadheading or invasiveness note | Regulated noxious weed in WA/OR; also emerges late and gets dug up as dead | Added the deadhead/sterile-cultivar rule and the late-emergence rule |
| flowering | "Cut back in spring, leaving 8–24 in stubs" | Unsourced timing; an early-March cut evicts the bees the rule exists to protect | Retimed to "only once it is reliably warm"; added the lay-the-tops-aside rule |
| universal | Months 2–3 best / 8–10 avoid under a "universal" topic | Hemisphere-inverted; SH users are blocked from their only correct window | Stamped NH with SH mirror; Clemson's ten-weeks-before-first-hard-frost carried as the relative backstop |
| universal | April and November unclassified | Undefined state in the two highest-stakes months | All 12 months classified; April and November acceptable, with the oak carve-out |
| universal | No Prunus exception | Dormant cuts admit silver leaf, which kills branches and trees | Added rule + never-rule: Prunus is pruned late spring to midsummer, never dormant |
| universal | May–July acceptable; "3 Ds in any month" | Oak wilt: sap beetles hit fresh oak wounds within minutes | Added the oak carve-out to the season note, the 3 Ds rule and the never list |
| universal | "3 Ds always safe … any month" | Not on frost-damaged tender evergreens — cutting early enlarges the kill | Qualified; separate rule to wait for spring growth on citrus and tender evergreens |
| universal | "Never paint, seal or tar a wound" absolute | Three real, recommended exceptions exist | Never-rule retargeted at *routine* sealing; the three exceptions are their own rule |
| universal | "25% of top, 25–30% of canopy in growing season" | Leads with the most permissive number; the 25–30% figure is unsourced and exceeds every cited cap | Rewritten to 20–25% young/shrubby, 10% live foliage on mature trees; merged with the mature-tree cap |
| universal | 1/4 in "= 5 mm", why-text tolerating 1/2 in | Bad conversion (1/4 in = 6.4 mm) plus contradiction with the never-rule | Harmonised on 1/4 in (6 mm) in both rule and never-rule; the 1/2 in tolerance deleted |
| universal | "Shorten to an outward-facing bud" | Over-generalised; Clemson says the bud faces the *preferred* direction | Reworded: outward to open a congested plant, inward to fill a gap |
| universal | Bleach dip "then rinse", cited to MU | MU says let it evaporate; the corrosion/rinse advice belongs to Clemson | Split into two rules matching the two sources, with the soil-neutralises-bleach and corrosion caveats |
| universal | "On a ladder: … top two rungs"; short PPE list | Stepladder-specific rule generalised; long sleeves, trousers and boots dropped | Scoped to stepladders, "face the ladder" added, full PPE list restored |
| universal | No topping rule | The most destructive common homeowner mistake was absent | Added never-rule against topping |
| universal | "Pests and pathogens are inactive" in winter | Backwards for silver leaf, whose spores peak in damp winter air | Softened to "most insect pests", with the silver leaf exception stated in the note |
| other classes | Never-rule vs the wisteria Jan/Feb cut | Direct contradiction; either path costs a season of bloom | Never-rule rewritten to forbid shortening the *whole framework*, with established wisteria spurs named as the exception |
| other classes | October–November `avoid` for all five classes | Contradicted by three of the pack's own sources (Arizona: Aug–Oct is prime for cactus; UC Marin: fall cuttings fine; RHS: late Nov–Dec is the main grape window) | `avoid_months` emptied; cactus rooting keyed to night temperature ≥ 60 °F (16 °C); grape window split by climate |
| other classes | All months NH-only | Grapes cut in SH high summer, wisteria dormant cut in SH midsummer, spring flagged avoid | Stamped NH with SH mirror; per-class phenological triggers given in the note |
| other classes | "Never remove more than one-third of a plant" | Clemson scopes it to woody ornamentals; contradicts grape (80–90%), wisteria spurs and pepper topping | Scoped to woody ornamental shrubs and trees, with the deliberate hard-prune cases carved out |
| other classes | "RHS: cuts after midwinter bleed sap" | Misquote — RHS says later than late Nov/Dec; also hides the Penn State cold-region disagreement | Threshold corrected and the window branched by climate (mild: late Nov–Dec; zone 6 and colder: Feb–early Mar) |
| other classes | "Cut columnar stems at 45 degrees" | Misread — the angle protects the *parent* plant; the source's next step, "square off the base of the cutting", was dropped | Split into the two steps the source gives |
| other classes | "24–48 h" callus time for all cuttings | Arizona says thick cuts may need months; a pad planted at 48 h rots | Rewritten to scale with the wound; judge by the wound, not the clock |
| other classes | Sage bundled with rosemary/lavender, "trim after flowering" | Neither cited source covers sage, and the timing is wrong for it; the 1 in figure belongs to the lavender page | Sage split into its own spring rule; measurement re-attributed to lavender |
| other classes | "Cut just above a leaf node" applied to cacti | Cacti have areoles, not leaf nodes | Node instruction restricted to branching succulents; cacti handled by their own rules |
| other classes | "Strip the bottom 12 in"; "top peppers at 12 in" | Two source qualifiers dropped: the first flower cluster stop line, and 6–8 in for super-hots | Both limits restored |
| other classes | "Clemson: removing yellow growth minimizes pests … strongest growth flush" | Attribution fabricated — Clemson attaches "minimize" to sanitising tools against disease | Restated to what Clemson says; unsupported claims dropped |
| other classes | "Pinch off flower spikes" for all soft herbs | UC Napa explicitly exempts Thai basil | Exception added as its own rule |
| other classes | "Autumn is worst … first frost kills soft growth" applied to houseplants | Indoor plants never meet a frost; false mechanism erodes the real warning | Rationale split by class: frost outdoors, low winter light indoors |

---

## On-device VLM grounding

The pruning rules are only half the feature. The other half is *showing* the user where. That half is
constrained by what Gemma 4 E2B can actually do on a phone.

### What the model can do

- **Coordinates are a trained capability, not a hack.** The Gemma 4 model card lists "Object detection …
  and pointing" among the vision capabilities. The documented convention is
  `{"box_2d": [y_min, x_min, y_max, x_max], "label": "…"}`, integers normalized to a **1000×1000 grid**,
  **y first**. Hugging Face reports the models "natively respond in JSON format with the detected
  bounding boxes — no need for specific instructions or grammar-constrained generation."
- This is new in Gemma 4. Gemma 3 had no spatial tokens and no confirmed detection training; PaliGemma
  used dedicated `<loc0000>`–`<loc1023>` tokens that **do not exist** in the Gemma 4 tokenizer.
- ⚠️ `[y, x, y, x]`, **not** COCO's `[x, y, x, y]`. This is the single most common integration bug.

### What it cannot do — the part that governs the UX

- Hugging Face's launch post: the **E2B/E4B tier is "functional but less precise"** than the 31B/26B
  variants, across GUI and everyday-object detection.
- Google's own vision doc, at a low vision-token budget: *"it does alright but it is clear that the image
  is being compressed quite a bit as it does not detect all cars and persons"* — 2 detections at a 70-token
  budget versus 6 at 560.
- The closest published analogue: a 4-bit **2B** VLM asked to localize damage on a car body scored 87.3%
  on semantic classification but **"misses elongated scratches entirely"** and gives *"spatially
  inconsistent answers on near-identical crops."* Their verdict: *"a grounding failure, not a capability
  failure."* **A branch is an elongated thin structure against a cluttered, self-similar background — the
  documented failure mode, not a hypothetical one.**
- **The vision-token budget is baked into the exported `.pte`.** Preprocessing happens inside the encoder
  via `llm::make_image_input`; there is no knob in `LLMModel`, `GenerationConfig` or `sendMessage` to raise
  it. For a 1.3 GB on-device build, assume the low end — exactly the regime Google's docs show missing
  detections in.

### Prompt format

Use **0–1000 integers, the `box_2d` key, y-first, inside a fenced JSON block**. That is the trained
convention; anything else is off-distribution.

| Format | Verdict |
|---|---|
| 0–1000 ints, `box_2d`, y-first | ✅ Use this — trained, documented, exampled at 2B in the KerasHub guide |
| Normalized 0–1 floats | ❌ Off-distribution; burns 4–6 tokens per number and invites decimal drift |
| 0–100 percentages | ❌ Off-distribution; easily confused with 0–1000 mid-generation |
| PaliGemma `<locXXXX>` | ❌ Those tokens are not in the Gemma 4 tokenizer |
| Raw `{"point":[y,x]}` | ⚠️ Prefer a box and derive the centroid — a box carries an uncertainty signal (its size) that a bare point discards |

Practical: **image before text** in the prompt (the E2B-it card is explicit); ask for **≤3 boxes**; expect
a natural-language preamble before the JSON, so parse the fenced block explicitly — extend the tolerant
extractor in `apps/mobile/src/lib/spike-vlm.ts` rather than duplicating it; Zod-validate the coordinates
per the D-17 all-output-validated rule.

### Budget

RNE publishes **no** Gemma 4 benchmark rows, so any number is an extrapolation from its LLaMA XNNPACK
tables (24 tok/s for 1B SpinQuant on Pixel 10; 11 tok/s for 3B; ~2–5 tok/s on mid-range Android CPU
third-party).

| Workload | Estimate on mid-range Android | Why |
|---|---|---|
| Text-only, ~150 tokens out | ~15–40 s warm | ~4–10 tok/s decode, negligible prefill |
| Image + JSON, ~150 tokens out | ~25–70 s warm | plus a vision-encoder pass and 70–1120 vision tokens of prefill |
| First call after load (cold) | +5–20 s | Gemma 4's PLE layers load on first-token consumption |

`LOCAL_SLOW_THRESHOLD_MS = 25_000` is well-calibrated for text and **optimistic for image + JSON**;
`LOCAL_HARD_CEILING_MS = 120_000` will genuinely fire on slow devices.

**Architectural consequence:** a separate coordinate pass roughly doubles wall-clock and the FIFO mutex in
`LocalEngineProvider` serializes it. **Fold the coordinate request into the existing diagnosis call's
output schema** — one image, one pass, one JSON.

### Honest UX framing this forces

The app draws guidance about cutting a living branch. Design so a wrong coordinate costs a tap, not a
branch.

1. **Text is load-bearing; the overlay is a hint.** The horticultural rule is deterministic and correct
   independent of any coordinate. Lead with it. The overlay only answers "roughly where do I look."
2. **Regions, not points.** Quantize to a coarse zone ("lower-left, inner canopy") or a large translucent
   halo. A 3×3 or 4×4 grid is honest; a 1000×1000 arrow is not.
3. **Model proposes, user disposes.** Show the region, then *"Is this the branch you meant?"* with a
   **draggable** marker. Highest-value mitigation, and cheap.
4. **Validate hard, fail to no-overlay.** Drop the overlay (keep the text) when any coord is outside
   0–1000; `y2 <= y1` or `x2 <= x1`; box area exceeds ~50–60% of the image (the documented "huge box
   covering the whole quadrant" failure); more boxes than requested; or the box falls outside the plant
   region from the diagnosis pass. **A missing overlay is a good outcome; a wrong overlay is not.**
5. **Hedge the copy, always.** "Likely area — check against the guidance below", never "Cut here". No
   confidence percentages: there is no calibration data behind one.
6. **Disclose once.** The first time an overlay appears: "this is an on-device estimate and can be wrong —
   confirm the branch yourself before cutting." Proportionate to an irreversible physical action.
7. **Phase it.** Ship the rules plus a coarse zone hint first, watch how often users drag the marker
   versus accept it, and tighten visual precision only if the accept rate earns it. That also keeps the
   feature inside one inference pass.

### API surface (verified against installed react-native-executorch v0.9.2)

- `response` streams token-by-token during **both** `generate()` and `sendMessage()` — but it is React
  state (one re-render per ~80 ms batch), so don't hang an expensive subtree off it, and **never parse a
  partial `response` as JSON**. Use it for a "thinking…" affordance; parse the resolved promise.
- Two image paths, both requiring `capabilities: ['vision']`:
  `generate([{ role: 'user', content: prompt, mediaPath: '/absolute/path.jpg' }])` (stateless, matches the
  existing assess flow) or `sendMessage('…', { imagePath: '/absolute/path.jpg' })` (stateful).
- Model constant `models.llm.gemma4_e2b_multimodal()` → `gemma4-e2b-multimodal`, pinned at v0.9.0 on HF.

---

## Sources

**UC ANR / UC Statewide IPM Program**
- Training, Pruning, and Thinning Citrus — https://ipm.ucanr.edu/PMG/GARDEN/FRUIT/CULTURAL/citruspruning.html
- Asian Citrus Psyllid and Huanglongbing Disease (Pest Notes 74155) — https://ipm.ucanr.edu/PMG/PESTNOTES/pn74155.html
- Sanitation (Home and Landscape) — https://ipm.ucanr.edu/home-and-landscape/sanitation/
- Pest Notes: Roses — Cultural Practices and Weed Control (Pub. 7465) — https://ipm.ucanr.edu/home-and-landscape/roses-cultural-practices-and-weed-control/
- Training and Pruning Grapes — https://ipm.ucanr.edu/PMG/GARDEN/FRUIT/CULTURAL/grtrainprune.html
- Pruning Citrus (Pub. 31-008C, Placer & Nevada Counties) — https://www.ccfruitandnuts.ucanr.edu/sites/default/files/2025-03/Pruning%20citrus,%20Placer%20Nevada.pdf
- Growing Citrus in Sacramento (GN 127) — https://ucanr.edu/sites/default/files/2013-07/72239.pdf
- Growing Great Citrus (Santa Clara MGs) — https://ucanr.edu/site/uc-master-gardeners-santa-clara-county/growing-great-citrus
- Easy Guide to Hard Pruning Roses this Winter (Contra Costa MGs) — https://ucanr.edu/site/uc-master-gardener-program-contra-costa-county/article/easy-guide-hard-pruning-roses-winter
- Garden Tool Care (Contra Costa MGs) — https://ucanr.edu/blog/hort-coco-uc-master-gardener-program-contra-costa/article/garden-tool-care
- Pruning Cuts (Marin MGs) — https://ucanr.edu/site/uc-marin-master-gardeners/pruning-cuts
- Pruning Fundamentals (Marin MGs) — https://ucanr.edu/site/uc-marin-master-gardeners/pruning-fundamentals
- Propagating Succulents (Marin MGs) — https://ucanr.edu/site/uc-marin-master-gardeners/propagating-succulents
- Harvesting Herbs, Healthy Garden Tips (Napa MGs) — https://ucanr.edu/sites/default/files/2021-07/153878.pdf
- Abundant rainfall spurs tree growth (Fresno MGs) — https://ucanr.edu/blog/fresno-gardening-green/article/abundant-rainfall-spurs-tree-growth-which-may-require-pruning
- Safety Note #2: Pruning Safety — https://ucanr.edu/sites/safety/files/3105.pdf

**Texas A&M AgriLife Extension**
- Citrus (Texas home citrus fact sheet) — https://aggie-horticulture.tamu.edu/fruit-nut/fact-sheets/citrus/
- Follow Proper Pruning Techniques (Earth-Kind) — https://aggie-horticulture.tamu.edu/earthkind/landscape/proper-pruning-techniques/
- Patio Citrus (Galveston County) — https://galveston.agrilife.org/2023/09/30/patio-citrus/
- Citrus Canker (PLPM-PU-067) — https://harris.agrilife.org/files/2023/01/citrus-canker.pdf

**University of Florida IFAS Extension**
- Citrus Culture in the Home Landscape (HS132) — https://ask.ifas.ufl.edu/publication/HS132
- Citrus Tree Pruning Principles and Practices (HS-144) — https://harris.agrilife.org/files/2011/05/Citrus-Pruning.pdf
- Mature Tree Pruning / Preventive Pruning (Gilman) — https://hos.ifas.ufl.edu/woody/preventive-pruning.shtml
- Clean Your Pruning Tools (Duval County) — https://blogs.ifas.ufl.edu/duvalco/2025/07/14/clean-your-pruning-tools/

**Clemson Cooperative Extension (HGIC)**
- Principles & Practices for Pruning Trees — https://hgic.clemson.edu/factsheet/pruning-trees/
- Pruning Shrubs — https://hgic.clemson.edu/factsheet/pruning-shrubs/
- Pruning Roses (HGIC 1173) — https://hgic.clemson.edu/factsheet/pruning-roses/
- Rose Diseases — https://hgic.clemson.edu/factsheet/rose-diseases/
- Rose Rosette Disease: FAQ & How to Identify It — https://hgic.clemson.edu/factsheet/rose-rosette-disease-frequently-asked-questions-how-to-identify-it/
- Pruning Hydrangeas — https://hgic.clemson.edu/factsheet/pruning-hydrangeas/
- Is It Time To Prune My Trees And Shrubs? — https://hgic.clemson.edu/is-it-time-to-prune-my-trees-and-shrubs/
- Topping Trees — https://hgic.clemson.edu/factsheet/topping-trees/
- Tool Hygiene — https://hgic.clemson.edu/tool-hygiene/
- Herbs — https://hgic.clemson.edu/factsheet/herbs/
- End-of-Winter Houseplant Care — https://hgic.clemson.edu/end-of-winter-houseplant-care-how-to-prepare-indoor-plants-for-spring/
- The Art and Science of Pruning — https://hgic.clemson.edu/hot-topic/the-art-and-science-of-pruning/

**University of Illinois Extension**
- Roses: Pruning — https://extension.illinois.edu/roses/pruning
- How to prune flowering shrubs for more blooms — https://extension.illinois.edu/blogs/good-growing/2024-02-02-how-prune-flowering-shrubs-more-blooms
- Prune properly, your forsythia and lilac shrubs will thank you — https://extension.illinois.edu/blogs/flowers-fruits-and-frass/2022-04-01-prune-properly-your-forsythia-and-lilac-shrubs-will-thank
- 3 ways to prune perennials for longer lasting blooms — https://extension.illinois.edu/blogs/ilriverhort/2023-06-06-3-ways-prune-perennials-longer-lasting-blooms
- Fall garden clean up with pollinators and other wildlife in mind — https://extension.illinois.edu/blogs/good-growing/2021-10-22-fall-garden-clean-pollinators-and-other-wildlife-mind
- Pruning tomatoes and peppers — https://extension.illinois.edu/blogs/flowers-fruits-and-frass/2021-05-17-pruning-tomatoes-and-peppers-healthier-plants-and
- Caring for Vines — https://extension.illinois.edu/flowers/caring-vines
- Lavender (Herbs) — https://extension.illinois.edu/herbs/lavender

**Iowa State University Extension and Outreach**
- Should I prune my rose back in the fall? — https://yardandgarden.extension.iastate.edu/faq/should-i-prune-my-rose-back-fall
- Deadheading Herbaceous Ornamentals and Roses — https://yardandgarden.extension.iastate.edu/how-to/deadheading-herbaceous-ornamentals-and-roses
- How to Maintain Perennial Beds and Borders — https://yardandgarden.extension.iastate.edu/how-to/how-maintain-perennial-beds-and-borders
- Growing Butterfly Bush in Iowa — https://yardandgarden.extension.iastate.edu/how-to/growing-butterfly-bush-iowa

**University of Minnesota Extension**
- Pruning hydrangeas for best bloom — https://extension.umn.edu/planting-and-growing-guides/pruning-hydrangeas-best-bloom
- Growing grapes in the home garden — https://extension.umn.edu/fruit/growing-grapes-home-garden

**Penn State Extension**
- Pruning Flowering Shrubs — https://extension.psu.edu/pruning-flowering-shrubs
- Pruning Herbaceous Plants — https://extension.psu.edu/pruning-herbaceous-plants
- How to Support Our Pollinators, Insects and Birds During the Winter Months — https://extension.psu.edu/programs/master-gardener/counties/lackawanna/news/how-to-support-our-pollinators-insects-and-birds-during-the-winter-months
- Dormant Cane and Spur Pruning in Bunch Grape Vineyards — https://extension.psu.edu/dormant-cane-and-spur-pruning-in-bunch-grape-vineyards

**University of Missouri Extension**
- Pruning Ornamental Trees and Shrubs (MG8) — https://extension.missouri.edu/publications/mg8
- Pruning and Care of Shade Trees (G6866) — https://extension.missouri.edu/publications/g6866
- Pruning Ornamental Shrubs (G6870) — https://extension.missouri.edu/publications/g6870
- Sanitize tools for good garden hygiene — https://extension.missouri.edu/news/sanitize-tools-for-good-garden-hygiene
- Use caution when hiring tree care professionals — https://extension.missouri.edu/news/use-caution-when-hiring-tree-care-professionals

**Other extension services**
- University of Georgia — Staking and Pruning Tomatoes in the Home Garden (C1150) — https://fieldreport.caes.uga.edu/publications/C1150/
- University of Arizona — How to Propagate Agaves and Cacti From Cuttings and Seed — https://extension.arizona.edu/sites/default/files/2025-03/How-to-Propagate-Agaves-and-Cacti-From-Cuttings-and-Seed.pdf
- Oregon State University — Pruning roses — https://extension.oregonstate.edu/gardening/flowers-shrubs-trees/pruning-roses

**Missouri Botanical Garden**
- How do I prune my flowering shrubs? — https://www.missouribotanicalgarden.org/gardens-gardening/your-garden/help-for-the-home-gardener/advice-tips-resources/gardening-help-faqs/question/786/how-do-i-prune-my-flowering-shrubs
- Indoor Plants or Houseplants (factsheet) — https://www.missouribotanicalgarden.org/Portals/0/Gardening/Gardening%20Help/Factsheets/Indoor%20Plants21.pdf
- Renovating an Indoor House Plant — https://www.missouribotanicalgarden.org/gardens-gardening/your-garden/help-for-the-home-gardener/advice-tips-resources/visual-guides/renovating-an-indoor-house-plant

**Royal Horticultural Society**
- How to grow citrus — https://www.rhs.org.uk/fruit/citrus/grow-your-own
- Rose pruning: general tips — https://www.rhs.org.uk/plants/roses/pruning-guide
- Rose pruning: floribunda and hybrid tea roses — https://www.rhs.org.uk/plants/roses/modern-bush/pruning-guide
- Rose pruning: climbing roses — https://www.rhs.org.uk/plants/roses/climbing/pruning-guide
- Rose pruning: shrub roses — https://www.rhs.org.uk/plants/roses/shrub/pruning-guide
- Deadheading Plants: How and Why — https://www.rhs.org.uk/garden-jobs/deadheading-plants
- Perennials: Cutting Back — https://www.rhs.org.uk/plants/types/perennials/cutting-back
- Hydrangea Pruning — https://www.rhs.org.uk/plants/hydrangea/pruning-guide
- How to Prune a Tree — https://www.rhs.org.uk/plants/types/trees/pruning-guide
- How to grow cacti and succulents — https://www.rhs.org.uk/plants/types/cacti-succulents/houseplants/growing-guide
- How to grow Rosemary — https://www.rhs.org.uk/herbs/rosemary/grow-your-own
- How to grow lavender — https://www.rhs.org.uk/plants/lavender/growing-guide
- How to grow cucumbers — https://www.rhs.org.uk/vegetables/cucumbers/grow-your-own
- Grapes: pruning and training — https://www.rhs.org.uk/fruit/grapes/pruning-training
- Wisteria Pruning Guide — https://www.rhs.org.uk/plants/wisteria/pruning-guide

**On-device VLM**
- Gemma 4 model card — https://ai.google.dev/gemma/docs/core/model_card_4
- Gemma image understanding docs — https://ai.google.dev/gemma/docs/capabilities/vision/image
- google/gemma-4-E2B-it — https://huggingface.co/google/gemma-4-E2B-it
- Welcome Gemma 4 (Hugging Face blog) — https://huggingface.co/blog/gemma4
- gemma-3-4b-it discussion #38 — https://huggingface.co/google/gemma-3-4b-it/discussions/38
- KerasHub Gemma 4 multimodal guide — https://keras.io/keras_hub/guides/gemma4_multimodal_and_agentic_workflows/
- PaliGemma (arXiv 2407.07726) — https://arxiv.org/html/2407.07726v1
- Grounding Agentic VLMs for Vehicle Damage (arXiv 2608.02470) — https://arxiv.org/html/2608.02470
- Molmo/PixMo (arXiv 2409.17146) — https://arxiv.org/html/2409.17146v2
- MolmoPoint (arXiv 2603.28069) — https://arxiv.org/pdf/2603.28069
- react-native-executorch useLLM — https://docs.swmansion.com/react-native-executorch/docs/hooks/natural-language-processing/useLLM
- RNE inference-time benchmarks — https://docs.swmansion.com/react-native-executorch/docs/benchmarks/inference-time
- RNE memory benchmarks — https://docs.swmansion.com/react-native-executorch/docs/benchmarks/memory-usage
- RNE issue #1062 (Gemma 4 support) — https://github.com/software-mansion/react-native-executorch/issues/1062
- Datature: Gemma 4 for computer vision engineers — https://datature.io/blog/gemma-4-what-computer-vision-engineers-actually-need-to-know
