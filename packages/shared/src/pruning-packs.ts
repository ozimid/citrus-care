// F23 rule packs — the horticultural data behind the pruning feature, split
// out from the selection/season logic in pruning-rules.ts so the content can be
// reviewed (and re-sourced) on its own — and, since 2026-08-31, shared with
// the web landing, whose /guides pages render these same packs.
//
// PROVENANCE: researched from US cooperative-extension services (UC ANR/IPM,
// Texas A&M AgriLife, UF/IFAS, Clemson, Missouri, Illinois, Oregon State,
// Minnesota, Penn State, Iowa State) and the RHS, then put through an
// adversarial fact-check; see docs/research/pruning-rules.md for the sources
// and for the list of corrections applied. Corrections already folded in here
// include: the quarter-canopy citrus cap (was fused with an incompatible
// third-of-height figure), rose cane selection by COUNT not age, the
// reblooming-hydrangea exception, the Prunus and oak-wilt carve-outs, the
// no-topping rule, and frost-tender wood being left until spring regrowth.
//
// EDITING RULES: every string is shown to a grower AND pasted into an on-device
// model prompt, so each stays under 140 characters and reads as an instruction.
// Month numbers are 1-12 in the NORTHERN hemisphere; pruning-rules.ts mirrors
// them for southern callers. Every month 1-12 must appear in exactly one of the
// three arrays — an unclassified month reads as permission.

export type PruningPackKey =
  | "citrus"
  | "rose"
  | "flowering_shrub"
  | "perennial"
  | "tree_shrub"
  | "succulent"
  | "herb"
  | "vegetable"
  | "vine"
  | "houseplant";

export interface PruningPack {
  key: PruningPackKey;
  /** Shown in the UI and used in the prompt ("a Citrus tree"). */
  label: string;
  /**
   * True only when this pack's MONTH WINDOWS come straight from the research's
   * own five packs (citrus, rose, flowering, universal). The remaining packs
   * split the research's deliberately-advisory "other classes" block by class,
   * so their months are our extrapolation — and the research is explicit that
   * those must never be presented as authoritative. A non-authoritative pack
   * can therefore say "good time" but never "bad time": seasonVerdict downgrades
   * its avoid months to an advisory line pointing at the rules, which ARE sourced.
   */
  authoritative: boolean;
  bestMonths: number[];
  okMonths: number[];
  avoidMonths: number[];
  /** The CONDITION behind the window, in the grower's words. Kept short: it
   * rides inside every season verdict line. */
  seasonNote: string;
  /** Which cut the technique diagram shows: "bud" = cut just above a bud
   * (roses, perennials, soft growth), "collar" = cut just outside the branch
   * collar (trees and woody shrubs). The diagram carries what a paragraph
   * used to — the user asked for pictures, not words. */
  technique: "bud" | "collar";
  /** Appended to the "dead, damaged or diseased wood can come off any month"
   * carve-out where that is NOT unconditional. Frost-damaged citrus is the
   * documented case: the dead material insulates what is still alive, so the
   * cut waits for spring regrowth. */
  alwaysAllowedCaveat?: string;
  rules: string[];
  never: string[];
}

export const PRUNING_PACKS: Record<PruningPackKey, PruningPack> = {
  citrus: {
    key: "citrus",
    label: "Citrus tree",
    technique: "collar",
    authoritative: true,
    bestMonths: [3, 4, 5],
    okMonths: [2, 6, 7, 8],
    avoidMonths: [9, 10, 11, 12, 1],
    seasonNote: "after your last frost, before summer heat — near bloom or just after fruit set",
    alwaysAllowedCaveat:
      "The exception is frost-damaged wood: wait for spring regrowth to show the true limit of the injury.",
    rules: [
      "Prune after your last frost and before summer heat, aiming just before bloom or just after fruit set.",
      "Do no shaping or size-reduction cuts from September through January — new growth won't harden before frost.",
      "Rub or cut off any shoot coming from below the graft union as soon as it appears, right back to the base.",
      "Remove water sprouts — unusually long, thick, upright shoots — at their base rather than heading them back.",
      "But on a freeze-damaged tree, keep the strongest well-placed sprouts above the graft union and train them to rebuild the canopy.",
      "Cut out dead, damaged or diseased wood in any month; in winter keep those cuts under 1/2 in (1.25 cm).",
      "Thin crossing branches and any branch shading the lower limbs, until dappled sun reaches the ground at midday.",
      "On an established in-ground tree, clear the foliage that rests on the soil every couple of years.",
      "Take no more than about a quarter of the canopy in a year.",
      "June-August cuts are light work only — thin and take deadwood, then whitewash every limb you newly expose.",
      "Whitewash newly exposed limbs with 50:50 white latex paint and water — bare citrus bark sunburns.",
      "Disinfect blades with 70% alcohol or 10% bleach between trees and after any cut into diseased wood.",
    ],
    never: [
      "Never cut a branch flush with the trunk — cut just outside the raised branch collar.",
      "Never seal a citrus cut with wound paint or tar (whitewash against sunburn is a different thing).",
      "Never cut freeze-damaged wood straight away — wait until spring regrowth shows the true limit of the damage.",
      "Never move citrus prunings, clippings or plants out of an HLB or citrus canker quarantine area.",
      "Never shear a potted citrus all over — hard-prune no more than one branch a year.",
      "Never skirt a young or container citrus — it strips fruiting canopy and exposes thin bark to sunburn.",
    ],
  },

  rose: {
    key: "rose",
    label: "Rose",
    technique: "bud",
    authoritative: true,
    bestMonths: [2, 3],
    okMonths: [1, 4, 5, 6, 7, 8, 12],
    avoidMonths: [9, 10, 11],
    seasonNote: "when the buds swell in late winter, about 3-4 weeks before your last killing frost",
    rules: [
      "Hard-prune bush roses as the buds swell in late winter — about 3-4 weeks before your average last killing frost.",
      "Cut on a slight slant sloping away from the bud, about 1/4 in (6 mm) above it; never nick the bud itself.",
      "Cut to an outward-facing bud so new shoots grow away from the centre, leaving an open, vase-shaped bush.",
      "Keep 3-6 strong canes from last year's growth (6-10 on a big mature bush) and take the rest out at ground level.",
      "Cut back to live white or pale-green pith, removing dead, brown-pithed, spindly and crossing canes.",
      "On hybrid teas, grandifloras and floribundas remove canes thinner than a pencil; judge shrub roses by vigour.",
      "Prune shrub and landscape roses lightly — each spring take about a third of the oldest canes to the base.",
      "Deadhead repeat bloomers just above the first outward-facing five-leaflet leaf.",
      "Only grafted roses get suckers: dig down to where the shoot leaves the root and tear it off, don't cut at soil level.",
      "Dip blades in 70% alcohol before each plant, and again right after cutting any diseased wood.",
    ],
    never: [
      "Never prune live canes in autumn in a cold-winter climate — soft regrowth cannot harden off before frost.",
      "Never hard-prune once-blooming roses, ramblers or spring-only climbers in late winter — prune them after they flower.",
      "Never leave a stub, above a bud or when taking a whole cane out at the base.",
      "Never carry sap from one rose to the next on unsterilised blades.",
      "Never try to prune rose rosette out of a plant — dig out and bag the whole thing, roots included.",
    ],
  },

  flowering_shrub: {
    key: "flowering_shrub",
    label: "Flowering shrub",
    technique: "collar",
    authoritative: true,
    bestMonths: [3, 4, 5, 6],
    okMonths: [1, 2, 7],
    avoidMonths: [8, 9, 10, 11, 12],
    seasonNote: "late winter for new-wood bloomers, right after the flowers fade for old-wood ones",
    rules: [
      "Find out first whether it blooms on old wood or new — that single fact decides the whole schedule.",
      "Spring bloomers (lilac, forsythia, weigela, azalea) bloom on old wood: prune within 2-3 weeks of the flowers fading.",
      "Summer bloomers (butterfly bush, panicle hydrangea, summer spirea) bloom on new wood: cut them back in late winter.",
      "Renew lilac and forsythia by taking about a third of the oldest stems to the ground.",
      "Non-reblooming bigleaf hydrangea: prune only just after bloom, and stop by about 1 August.",
      "Reblooming hydrangeas (Endless Summer and similar) flower on old and new wood, so timing matters far less.",
      "Deadhead by cutting just above the next healthy pair of leaves or buds.",
      "Take dead, diseased or damaged wood out first, in any month — that comes before every season rule here.",
      "Cut just outside the branch collar; on limbs over 1.5 in (4 cm) use three cuts so the bark can't tear.",
      "Take no more than about a quarter of a shrub in one go.",
    ],
    never: [
      "Never prune an old-wood shrub in late summer, autumn or winter — next year's flower buds are already set.",
      "Never prune non-reblooming bigleaf or lacecap hydrangea after about 1 August.",
      "Never shear a flowering shrub into a ball — it destroys both the form and the flowering wood.",
      "Never leave a stub, and never cut flush with the trunk.",
      "Never top a shrub or tree back to stubs to reduce its height.",
    ],
  },

  perennial: {
    key: "perennial",
    label: "Flowering perennial",
    technique: "bud",
    authoritative: false,
    bestMonths: [4, 5, 6, 7],
    okMonths: [3, 8],
    avoidMonths: [9, 10, 11, 12, 1, 2],
    seasonNote: "deadhead through the season; cut back in spring once frost has passed, not in autumn",
    rules: [
      "Deadhead by cutting the spent bloom just above the next healthy set of leaves or buds.",
      "On spikes like delphinium and lupin, pick off spent florets first, then cut the spike to a lower bud or the base.",
      "Cut early bloomers (hardy geranium, delphinium, catmint) near the ground after flowering for fresh leaves.",
      "Pinch out shoot tips early in growth to force branching, staggering the pinches over about three weeks.",
      "Stop pinching mums by early July and asters by mid-July, or you remove the buds for the autumn display.",
      "Cut late bloomers — coneflower, phlox, tall sedum, goldenrod — back by a third in late May or early June.",
      "Leave seed heads standing over winter for the birds; cut back only once it is reliably warm and insects have emerged.",
      "When you do cut back, leave 8-24 in stubs standing — they become this year's nesting sites.",
      "Wait until the last frost has passed in your area before cutting back tender woody perennials like penstemon.",
      "As a default take no more than half the foliage at once — the after-flowering hard cut-back is the exception.",
      "Snip out dead, damaged or diseased growth in any month.",
    ],
    never: [
      "Never deadhead plants you keep for seed heads or self-seeding — rudbeckia, cornflower, sunflower, honesty.",
      "Never cut tender woody perennials down in autumn — the old top growth is what protects the crown.",
      "Never cut into the bare old wood of a woody-stemmed perennial; it usually will not reshoot.",
    ],
  },

  tree_shrub: {
    key: "tree_shrub",
    label: "Tree or shrub",
    technique: "collar",
    authoritative: true,
    bestMonths: [2, 3],
    okMonths: [1, 4, 5, 6, 7, 11, 12],
    avoidMonths: [8, 9, 10],
    seasonNote: "late dormancy — after the worst cold, before bud break, when wounds close fastest",
    rules: [
      "Prune in late dormancy, after the worst cold but before bud break: wounds close fast and pests are inactive.",
      "Do the 3 Ds first — dead, diseased, damaged — then anything crossing or rubbing.",
      "Start the cut just outside the branch bark ridge and finish just outside the swelling of the branch collar.",
      "For limbs over 1.5 in (4 cm) use three cuts: undercut, then cut off further out, then the final collar cut.",
      "Shorten a shoot to a bud facing the way you want the growth to go, about 1/4 in (6 mm) above it.",
      "Take no more than 20-25% of a young or shrubby plant at once, and under 10% of live foliage on a mature tree.",
      "Take nothing live off a stressed tree — wait until it has recovered.",
      "Stone fruit and ornamental Prunus are the reverse case: prune them in summer, not in the damp dormant season.",
      "Where oak wilt occurs, do not prune oaks April-July; save oak work for November-March.",
      "Disinfect blades between plants: about two minutes in 1 part bleach to 9 parts water, then dry and oil them.",
    ],
    never: [
      "Never cut a branch off flush with the trunk.",
      "Never leave a stub past the collar, or more than about 1/4 in above a bud.",
      "Never take a heavy limb off with a single cut from above — the bark tears down the trunk.",
      "Never top a tree back to stubs to reduce its height; it starves the tree and forces weak, failure-prone regrowth.",
      "Never routinely seal or paint a pruning wound — dressings do not stop decay.",
      "Never prune within 10 feet of a power line; that work belongs to a certified arborist.",
    ],
  },

  succulent: {
    key: "succulent",
    label: "Succulent or cactus",
    technique: "bud",
    authoritative: false,
    bestMonths: [4, 5, 6, 7, 8, 9],
    okMonths: [3, 10],
    avoidMonths: [11, 12, 1, 2],
    seasonNote: "in warm weather while it is growing, so the cut face calluses instead of rotting",
    rules: [
      "Most succulents and cacti never need pruning — cut only what is dead, damaged or badly leggy.",
      "Shorten a leggy branching succulent just above a leaf node; it rebranches from there.",
      "Take prickly-pear pads off at the joint where the pads meet, and offsets with a short stub of stem.",
      "Cut a columnar cactus at a 45° angle so water sheds off the wound left on the parent plant.",
      "Let the cut callus before replanting: a day or two for small cuttings, weeks for pads, longer for thick stems.",
      "Work in warm weather — a cut made in the cold sits open and rots instead of callusing.",
      "Use a clean, sharp blade and wipe it between plants.",
    ],
    never: [
      "Never plant a fresh cut, pad or offset straight into soil — dry it until the wound has callused over.",
      "Never water a freshly cut succulent; a wet cut face rots.",
      "Never take more than about a third of the plant at once.",
    ],
  },

  herb: {
    key: "herb",
    label: "Herb",
    technique: "bud",
    authoritative: false,
    bestMonths: [4, 5, 6, 7, 8],
    okMonths: [3, 9],
    avoidMonths: [10, 11, 12, 1, 2],
    seasonNote: "right through the growing season; leave the woody kinds until after they flower",
    rules: [
      "Harvesting is pruning: cut soft herbs just above a pair of good-sized leaves and they branch from there.",
      "Pinch basil flower spikes out as soon as they appear — except Thai basil, whose flowers can be left on.",
      "Trim rosemary, lavender and thyme lightly once a year, right after the flowers fade.",
      "On lavender take the spent stalks plus about 1 in (2.5 cm) of leafy growth, and no more.",
      "Prune sage in spring as new growth resumes, then trim it lightly through the season.",
      "Pinch the tips of mint, basil and oregano regularly to keep them bushy instead of leggy.",
    ],
    never: [
      "Never cut lavender, rosemary, thyme or sage back into bare old wood — it usually will not reshoot.",
      "Never strip more than about a third of a herb in one harvest.",
    ],
  },

  vegetable: {
    key: "vegetable",
    label: "Vegetable plant",
    technique: "bud",
    authoritative: false,
    bestMonths: [5, 6, 7, 8],
    okMonths: [4, 9],
    avoidMonths: [10, 11, 12, 1, 2, 3],
    seasonNote: "through the growing season, while the plant is actively setting fruit",
    rules: [
      "Pinch suckers out of an indeterminate tomato's leaf axils while they are still small enough to remove by hand.",
      "At planting, take off any tomato stems touching the soil — that is how soil-borne disease gets in.",
      "Once tomatoes reach about 24 in, strip the leaves from the bottom 12 in, or up to the first flower cluster.",
      "On super-hot peppers strip only the bottom 6-8 in.",
      "Top peppers at about 12 in, cutting back to the second set of leaves, to force branching.",
      "Cut with clean blades and carry the prunings away from the bed rather than dropping them on the soil.",
    ],
    never: [
      "Never remove suckers from a determinate (bush) tomato — bottom-pruning is the only pruning it gets.",
      "Never thin the foliage so hard that fruit is left sitting in full sun; it scalds.",
    ],
  },

  vine: {
    key: "vine",
    label: "Vine",
    technique: "bud",
    authoritative: false,
    bestMonths: [12, 1, 2],
    okMonths: [3, 7, 8, 11],
    avoidMonths: [4, 5, 6, 9, 10],
    seasonNote: "while fully dormant and before the buds swell — a late cut bleeds sap",
    rules: [
      "Prune a deciduous vine while it is fully dormant and before bud swell; cuts made later bleed sap.",
      "Grapes: take off 80-90% of last season's growth, leaving short 2-4 bud spurs or a few longer canes.",
      "Wisteria takes two cuts a year: shorten the whippy shoots to 5-6 leaves in summer, then to 2-3 buds in winter.",
      "Prune a spring-flowering climber right after the flowers fade, not in late winter — that pack is the flowering-shrub one.",
      "Tie the framework in as you go — a vine you can actually see is a vine you can prune.",
      "Cut just above a bud, on a slight slant sloping away from it.",
    ],
    never: [
      "Never shorten the whole framework of a spring-flowering vine in late winter — you cut off that year's flowers.",
      "Never let a vine reach a roof, gutter or power line before you cut it back.",
    ],
  },

  houseplant: {
    key: "houseplant",
    label: "Houseplant",
    technique: "bud",
    authoritative: false,
    bestMonths: [3, 4, 5, 6, 7],
    okMonths: [2, 8],
    avoidMonths: [9, 10, 11, 12, 1],
    seasonNote: "in the brighter half of the year, when there is light enough to fund the regrowth",
    rules: [
      "Cut just above a leaf or a growth bud — the stem branches from just below the cut.",
      "Pinch a soft growing tip out to make the stem branch there.",
      "Take off dead, yellow or leggy growth whenever you see it, using sanitised snips.",
      "Save heavier cutting back for late winter, just before the spring growth flush.",
      "Sanitise snips between plants — that is how leaf disease travels from pot to pot indoors.",
      "Take no more than about a third of the plant at once.",
    ],
    never: [
      "Never cut hard in autumn — low winter light cannot fund the regrowth.",
      "Never cut into a bare cane hoping for leaves; cut back to a visible node instead.",
    ],
  },
};
