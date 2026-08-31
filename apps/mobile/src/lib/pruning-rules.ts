// F23 — the deterministic half of pruning: which rules apply to this plant,
// and whether now is the time. This module is the reason the feature is safe to
// ship: the model's job is to point at branches, and THIS is where the
// horticulture comes from. Every rule is sourced from US cooperative-extension
// services and the RHS (docs/research/pruning-rules.md), then adversarially
// fact-checked; corrections from that pass are folded into the text here.
//
// Three things the fact-check forced, worth not undoing:
//  1. HEMISPHERE. Every source is northern-hemisphere. Month arrays are stored
//     northern and mirrored six months for a southern-hemisphere caller, and
//     every verdict leads with the CONDITION ("after your last frost") rather
//     than the month, so the advice survives a grower we guessed wrong about.
//  2. THE 3 Ds ALWAYS WIN. Dead, damaged and diseased wood may come off in any
//     month; no season verdict may read as "don't touch it". Two exceptions are
//     carried in the rule text itself: frost-damaged citrus (wait for regrowth)
//     and oaks in the oak-wilt window.
//  3. EVERY MONTH IS CLASSIFIED. An unclassified month used to fall through to
//     "no opinion", which reads as permission.

import type { PruningPackKey } from "./pruning-rules-packs";
import { PRUNING_PACKS, type PruningPack } from "./pruning-rules-packs";
import { monthsLabel } from "./watering";

export { PRUNING_PACKS };
export type { PruningPack, PruningPackKey };

/** Which half of the world the grower is in. Northern is the default because
 * every source behind these windows is, and because the app's ZIP field and
 * quarantine data are US — but a wrong guess must never be silent, which is why
 * the verdict line always states the condition as well as the month. */
export type Hemisphere = "northern" | "southern";

export interface PlantIdentity {
  name: string;
  plant_type: string;
  species: string | null;
  cultivar: string | null;
}

/** Species keywords that beat plant_type. A grower who typed "shrub" for a
 * lilac still needs lilac's rules — the plant decides, not the dropdown. */
const KEYWORD_PACKS: ReadonlyArray<{ key: PruningPackKey; pattern: RegExp }> = [
  {
    key: "citrus",
    pattern:
      /\b(citrus|lemon|lime|orange|mandarin|satsuma|clementine|tangerine|kumquat|grapefruit|pomelo|bergamot|yuzu|calamansi)\b/,
  },
  // \b keeps "rosemary" out: the 'm' is a word character, so \brose\b can't
  // match inside it. ROSE_IMPOSTORS handles the other half of the problem —
  // plants whose common name ends in "rose" and which are not roses at all.
  { key: "rose", pattern: /\bros(e|es|a)\b/ },
  {
    key: "flowering_shrub",
    pattern:
      /\b(hydrangea|lilac|forsythia|weigela|azalea|rhododendron|camellia|spirea|spiraea|buddleia|buddleja|butterfly bush|mock orange|philadelphus|viburnum|rose of sharon|hibiscus|althea)\b/,
  },
  // Spring-flowering climbers go to the flowering-shrub pack, NOT here: the
  // vine pack's best window is deep dormancy (right for grape and wisteria),
  // which is precisely what its own never-rule forbids for anything that
  // flowers on last year's wood.
  {
    key: "flowering_shrub",
    pattern: /\b(clematis|honeysuckle|jasmine|bougainvillea|wisteria vine)\b/,
  },
  {
    key: "vine",
    pattern: /\b(grape|grapevine|vine|wisteria|ivy|passion ?flower)\b/,
  },
  {
    key: "succulent",
    pattern: /\b(cactus|cacti|succulent|aloe|echeveria|jade|agave|haworthia|opuntia|prickly pear)\b/,
  },
  {
    key: "herb",
    pattern: /\b(basil|mint|rosemary|thyme|sage|oregano|parsley|lavender|cilantro|coriander|chive|chives|tarragon)\b/,
  },
  { key: "vegetable", pattern: /\b(tomato|tomatoes|pepper|peppers|chilli|chili|cucumber|aubergine|eggplant)\b/ },
  {
    key: "houseplant",
    pattern:
      /\b(monstera|pothos|philodendron|ficus|dracaena|sansevieria|snake plant|peace lily|spathiphyllum|rubber plant|zz plant|calathea|fiddle ?leaf)\b/,
  },
];

/** plant_type is the fallback when nothing in the words is recognisable. */
const TYPE_PACKS: Record<string, PruningPackKey> = {
  tree: "tree_shrub",
  shrub: "tree_shrub",
  flower: "perennial",
  succulent: "succulent",
  vegetable: "vegetable",
  herb: "herb",
  vine: "vine",
  other: "tree_shrub",
};

/** Common names that end in "rose" but belong to something else entirely.
 * Rose rules (hard-prune to 3-6 canes as the buds swell) would wreck an
 * Adenium or a hellebore, so these must never reach the rose pack. */
const ROSE_IMPOSTORS =
  /\b(desert|rock|christmas|lenten|sun|moss|primrose|rose of sharon|rosewood|rose ?mallow)\b/;

function matchKeywords(words: string): PruningPack | null {
  if (words.length === 0) return null;
  for (const { key, pattern } of KEYWORD_PACKS) {
    if (key === "rose" && ROSE_IMPOSTORS.test(words)) continue;
    if (pattern.test(words)) return PRUNING_PACKS[key];
  }
  return null;
}

/** Own-property lookup only. plant_type comes from stored data, which an
 * imported backup can fill with anything: a plain-object index would return
 * inherited members like "constructor" and crash on the missing pack. */
function packKeyForType(plantType: string): PruningPackKey {
  return Object.prototype.hasOwnProperty.call(TYPE_PACKS, plantType)
    ? TYPE_PACKS[plantType]
    : "tree_shrub";
}

/**
 * The rule pack for a plant, in order of how much the evidence is worth:
 *
 *  1. species + cultivar — what the plant actually IS.
 *  2. the plant's NAME, but only when species and cultivar are both blank. A
 *     name is a pet name: a rose called "Mr Lemon" must get rose rules, so the
 *     name is evidence only when nothing better exists.
 *  3. plant_type, then the generic woody pack as the floor — there is no "no
 *     rules" answer, because the cut mechanics (collar, stub, three cuts) apply
 *     to anything with a stem.
 */
export function pruningPackFor(plant: PlantIdentity): PruningPack {
  const identified = `${plant.species ?? ""} ${plant.cultivar ?? ""}`.toLowerCase().trim();
  const bySpecies = matchKeywords(identified);
  if (bySpecies) return bySpecies;

  if (identified.length === 0) {
    const byName = matchKeywords((plant.name ?? "").toLowerCase().trim());
    if (byName) return byName;
  }
  return PRUNING_PACKS[packKeyForType(plant.plant_type)];
}

export type SeasonStatus = "best" | "ok" | "avoid" | "off_season";

export interface SeasonVerdict {
  status: SeasonStatus;
  /** One line, safe to show and safe to put in a prompt. */
  line: string;
}

/** Southern-hemisphere seasons run six months out of phase with every source
 * these windows came from. */
function shift(month: number, hemisphere: Hemisphere): number {
  return hemisphere === "southern" ? ((month + 5) % 12) + 1 : month;
}

/** Mirror into the grower's own calendar, then reuse F37's formatter — it
 * already walks the month wheel, so a wrapping window prints "Dec–Feb" instead
 * of the scrambled "Jan, Feb, Dec" a numeric sort produces. Six of ten packs
 * wrap once mirrored south, so this is the southern grower's normal case. */
function windowLabel(months: number[], hemisphere: Hemisphere): string {
  return monthsLabel(months.map((m) => shift(m, hemisphere))) ?? "";
}

/** The 3 Ds carve-out, appended wherever the verdict could be read as "leave it
 * alone" — an adversarial-review requirement, not decoration. Not unconditional
 * everywhere, so a pack may qualify it (frost-damaged citrus waits for spring). */
const ALWAYS_ALLOWED = "Dead, damaged or diseased wood can come off in any month.";

function alwaysAllowed(pack: PruningPack): string {
  return pack.alwaysAllowedCaveat ? `${ALWAYS_ALLOWED} ${pack.alwaysAllowedCaveat}` : ALWAYS_ALLOWED;
}

/** Is now the time? Deterministic — this never goes near the model. The month
 * is the caller's LOCAL month (1-12); anything else is treated as unknown
 * rather than guessed at. */
export function seasonVerdict(
  pack: PruningPack,
  month: number,
  hemisphere: Hemisphere = "northern",
): SeasonVerdict {
  const best = windowLabel(pack.bestMonths, hemisphere);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return {
      status: "off_season",
      line: `${pack.label}: the best window is ${best} — ${pack.seasonNote}. ${alwaysAllowed(pack)}`,
    };
  }
  // Compare in the pack's own (northern) frame, so the stored arrays stay the
  // single source of truth. Shifting by six months is its own inverse, so the
  // same helper maps both ways.
  const packMonth = shift(month, hemisphere);

  if (pack.bestMonths.includes(packMonth)) {
    return {
      status: "best",
      line: `${pack.label}: now is the best time to prune — ${pack.seasonNote}.`,
    };
  }
  if (pack.okMonths.includes(packMonth)) {
    return {
      status: "ok",
      line: `${pack.label}: you can prune now, but ${best} is better — ${pack.seasonNote}.`,
    };
  }
  if (pack.avoidMonths.includes(packMonth)) {
    // A window we extrapolated may suggest, never forbid: the research is
    // explicit that the "other classes" months are advisory and that their
    // avoid-block was dismantled. The pack's RULES are the sourced part, so
    // that is what an unsure month points at.
    if (!pack.authoritative) {
      return {
        status: "off_season",
        line: `${pack.label}: months vary by species in this group — usually ${best}, but go by the rules below rather than the calendar. ${alwaysAllowed(pack)}`,
      };
    }
    return {
      status: "avoid",
      line: `${pack.label}: a bad time to prune. Wait for ${best} — ${pack.seasonNote}. ${alwaysAllowed(pack)}`,
    };
  }
  return {
    status: "off_season",
    line: `${pack.label}: not the usual window; ${best} is the one that matters — ${pack.seasonNote}. ${alwaysAllowed(pack)}`,
  };
}

/** What the pruning prompt needs: the class, today's verdict, and the rules the
 * model must obey. The rules are correct by construction; the model's only job
 * is to apply them to what it can see. */
export function promptRulesFor(
  plant: PlantIdentity,
  month: number,
  hemisphere: Hemisphere = "northern",
): { className: string; seasonLine: string; rules: string[]; never: string[] } {
  const pack = pruningPackFor(plant);
  return {
    className: pack.label,
    seasonLine: seasonVerdict(pack, month, hemisphere).line,
    rules: pack.rules,
    never: pack.never,
  };
}

/** The short version the chat carries as "this plant's law" — the season plus
 * the few rules an answer most often needs to not contradict. Kept to six lines
 * because every one of them is re-tokenized on every question. */
export function chatCareRules(
  plant: PlantIdentity,
  month: number,
  hemisphere: Hemisphere = "northern",
): string[] {
  const pack = pruningPackFor(plant);
  return [
    seasonVerdict(pack, month, hemisphere).line,
    ...pack.rules.slice(0, 3),
    ...pack.never.slice(0, 2),
  ];
}
