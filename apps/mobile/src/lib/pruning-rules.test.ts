import { describe, expect, it } from "vitest";
import { PLANT_TYPES } from "@citrus/shared";
import {
  PRUNING_PACKS,
  chatCareRules,
  promptRulesFor,
  pruningPackFor,
  seasonVerdict,
  type PruningPack,
} from "./pruning-rules";

function plant(overrides: Partial<Parameters<typeof pruningPackFor>[0]> = {}) {
  return {
    name: "Mr Lemon",
    plant_type: "tree",
    species: "Meyer lemon",
    cultivar: null,
    ...overrides,
  };
}

describe("pack selection follows the plant, not the label", () => {
  it("recognises citrus from the species even on a shrub-typed row", () => {
    expect(pruningPackFor(plant()).key).toBe("citrus");
    expect(pruningPackFor(plant({ plant_type: "shrub", species: "Kaffir lime" })).key).toBe("citrus");
    expect(pruningPackFor(plant({ species: null, name: "Satsuma by the gate" })).key).toBe("citrus");
    expect(pruningPackFor(plant({ species: null, cultivar: "Valencia Orange" })).key).toBe("citrus");
  });

  it("recognises a rose without being fooled by rosemary", () => {
    expect(pruningPackFor(plant({ plant_type: "flower", species: "Rose", name: "Front bed" })).key).toBe("rose");
    expect(pruningPackFor(plant({ plant_type: "shrub", species: "Rosa rugosa" })).key).toBe("rose");
    expect(pruningPackFor(plant({ plant_type: "flower", species: null, name: "Climbing roses" })).key).toBe("rose");
    expect(pruningPackFor(plant({ plant_type: "herb", species: "Rosemary", name: "Rosemary" })).key).toBe("herb");
  });

  it("routes a named old-wood shrub to the flowering-shrub pack", () => {
    for (const species of ["Hydrangea macrophylla", "Lilac", "Forsythia"]) {
      expect(pruningPackFor(plant({ plant_type: "shrub", species })).key).toBe("flowering_shrub");
    }
  });

  // The vine pack's best window is deep dormancy, which is right for grape and
  // wisteria and is exactly what the pack's own never-rule forbids for a
  // climber that flowers on last year's wood.
  it("keeps spring-flowering climbers out of the dormant-vine window", () => {
    for (const species of ["Clematis", "Honeysuckle", "Jasmine"]) {
      expect(pruningPackFor(plant({ plant_type: "vine", species })).key).toBe("flowering_shrub");
    }
    expect(pruningPackFor(plant({ plant_type: "vine", species: "Grape" })).key).toBe("vine");
    expect(pruningPackFor(plant({ plant_type: "vine", species: "Wisteria" })).key).toBe("vine");
  });

  it("falls back on plant_type for anything unrecognised", () => {
    expect(pruningPackFor(plant({ plant_type: "succulent", species: "Echeveria" })).key).toBe("succulent");
    expect(pruningPackFor(plant({ plant_type: "vegetable", species: "Tomato" })).key).toBe("vegetable");
    expect(pruningPackFor(plant({ plant_type: "vine", species: "Grape" })).key).toBe("vine");
    expect(pruningPackFor(plant({ plant_type: "herb", species: "Basil" })).key).toBe("herb");
    expect(pruningPackFor(plant({ plant_type: "flower", species: "Dahlia" })).key).toBe("perennial");
  });

  it("has a pack for every plant type the app can create", () => {
    for (const type of PLANT_TYPES) {
      const pack = pruningPackFor(plant({ plant_type: type, species: null, cultivar: null, name: "x" }));
      expect(pack.rules.length).toBeGreaterThan(0);
    }
  });

  // "rose" is a common name component on plants that are not roses at all, and
  // rose rules (hard-prune to 3-6 canes in late winter) would wreck them.
  it("does not hand rose rules to plants that merely have 'rose' in the name", () => {
    expect(pruningPackFor(plant({ plant_type: "succulent", species: "Desert rose" })).key).toBe("succulent");
    expect(pruningPackFor(plant({ plant_type: "shrub", species: "Rose of Sharon" })).key).toBe("flowering_shrub");
    expect(pruningPackFor(plant({ plant_type: "flower", species: "Christmas rose" })).key).toBe("perennial");
    expect(pruningPackFor(plant({ plant_type: "shrub", species: "Rock rose" })).key).toBe("tree_shrub");
    // …but a real rose still gets the rose pack.
    expect(pruningPackFor(plant({ plant_type: "shrub", species: "Rosa rugosa" })).key).toBe("rose");
    expect(pruningPackFor(plant({ plant_type: "flower", species: "Hybrid tea rose" })).key).toBe("rose");
  });

  // Stored data is untrusted: a backup can carry any string as plant_type, and
  // a plain-object lookup happily returns inherited members.
  it("survives a plant_type that names an Object.prototype member", () => {
    for (const plant_type of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      const pack = pruningPackFor(plant({ plant_type, species: null, cultivar: null, name: "x" }));
      expect(pack.key, plant_type).toBe("tree_shrub");
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(pruningPackFor(plant({ species: "  MEYER LEMON  " })).key).toBe("citrus");
  });
});

describe("every pack is fit to go into a prompt and onto a screen", () => {
  const packs = Object.values(PRUNING_PACKS) as PruningPack[];

  it("covers a non-trivial set of classes", () => {
    expect(packs.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps every rule short enough to survive a small model's context", () => {
    for (const pack of packs) {
      for (const rule of [...pack.rules, ...pack.never]) {
        expect(rule.length, `${pack.key}: ${rule}`).toBeLessThanOrEqual(140);
        expect(rule.trim()).toBe(rule);
        expect(rule.length).toBeGreaterThan(0);
      }
    }
  });

  it("always says what NOT to do — the dangerous half of pruning advice", () => {
    for (const pack of packs) expect(pack.never.length, pack.key).toBeGreaterThan(0);
  });

  it("uses real month numbers and never calls a month both best and avoid", () => {
    for (const pack of packs) {
      const months = [...pack.bestMonths, ...pack.okMonths, ...pack.avoidMonths];
      for (const month of months) {
        expect(Number.isInteger(month)).toBe(true);
        expect(month).toBeGreaterThanOrEqual(1);
        expect(month).toBeLessThanOrEqual(12);
      }
      const best = new Set(pack.bestMonths);
      expect(pack.avoidMonths.filter((m) => best.has(m)), pack.key).toEqual([]);
      expect(pack.label.length).toBeGreaterThan(0);
      expect(pack.seasonNote.length).toBeGreaterThan(0);
    }
  });
});

describe("pack month arrays are complete and honest about their provenance", () => {
  const packs = Object.values(PRUNING_PACKS) as PruningPack[];

  // An unclassified month used to fall through to "no opinion", which a grower
  // reads as permission. This is the only automated evidence for that rule.
  it("classifies all twelve months exactly once in every pack", () => {
    for (const pack of packs) {
      const all = [...pack.bestMonths, ...pack.okMonths, ...pack.avoidMonths].sort((a, b) => a - b);
      expect(all, `${pack.key} months`).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }
  });

  it("marks which packs' windows actually come from the research", () => {
    // The research doc is explicit that the "other classes" months are advisory
    // and that their avoid-block was dismantled. Packs whose windows we
    // extrapolated must not be presented with the same authority.
    const sourced = packs.filter((p) => p.authoritative).map((p) => p.key).sort();
    expect(sourced).toEqual(["citrus", "flowering_shrub", "rose", "tree_shrub"]);
  });

  it("never issues a hard avoid verdict from a pack we only extrapolated", () => {
    for (const pack of packs.filter((p) => !p.authoritative)) {
      for (let month = 1; month <= 12; month++) {
        expect(seasonVerdict(pack, month).status, `${pack.key} m${month}`).not.toBe("avoid");
      }
    }
  });

  it("still issues a hard avoid from a sourced pack", () => {
    expect(seasonVerdict(PRUNING_PACKS.citrus, 11).status).toBe("avoid");
  });
});

describe("southern hemisphere (the ship-blocker the fact-check found)", () => {
  it("mirrors a sourced window six months", () => {
    // Citrus is pruned Mar-May in the north; that is Sep-Nov in the south.
    const north = seasonVerdict(PRUNING_PACKS.citrus, 4, "northern");
    const south = seasonVerdict(PRUNING_PACKS.citrus, 10, "southern");
    expect(north.status).toBe("best");
    expect(south.status).toBe("best");
    expect(seasonVerdict(PRUNING_PACKS.citrus, 4, "southern").status).not.toBe("best");
  });

  it("names the southern months in the verdict, not the northern ones", () => {
    expect(seasonVerdict(PRUNING_PACKS.citrus, 1, "southern").line).toContain("Sep–Nov");
    expect(seasonVerdict(PRUNING_PACKS.citrus, 1, "northern").line).toContain("Mar–May");
  });

  it("renders a year-wrapping window as a range, not a scrambled list", () => {
    // The vine pack is Dec-Feb in the north; sorting numerically would print
    // "Jan, Feb, Dec". Six of nine packs wrap once mirrored south, so this is
    // the southern grower's normal case, not an edge case.
    expect(seasonVerdict(PRUNING_PACKS.vine, 6, "northern").line).toContain("Dec–Feb");
    // Perennials are best Apr-Jul in the north, so Oct-Jan for a southern grower.
    expect(seasonVerdict(PRUNING_PACKS.perennial, 9, "southern").line).toMatch(/Oct–Jan/);
  });

  it("carries the mirror through to what the model and the chat are told", () => {
    expect(promptRulesFor(plant(), 10, "southern").seasonLine).toContain("best time");
    expect(chatCareRules(plant(), 10, "southern")[0]).toContain("best time");
  });
});

describe("seasonVerdict is deterministic, not model output", () => {
  const pack: PruningPack = {
    key: "citrus",
    label: "Citrus tree",
    authoritative: true,
    bestMonths: [3, 4],
    okMonths: [5, 6],
    avoidMonths: [11, 12, 1],
    seasonNote: "after the last frost, before the summer flush",
    rules: ["Cut just outside the branch collar."],
    never: ["Never cut flush with the trunk."],
  };

  it("names the month and the class in every verdict", () => {
    for (let month = 1; month <= 12; month++) {
      const verdict = seasonVerdict(pack, month);
      expect(verdict.line).toContain("Citrus tree");
      expect(verdict.line.length).toBeGreaterThan(10);
      expect(["best", "ok", "avoid", "off_season"]).toContain(verdict.status);
    }
  });

  it("reads the calendar correctly", () => {
    expect(seasonVerdict(pack, 3).status).toBe("best");
    expect(seasonVerdict(pack, 6).status).toBe("ok");
    expect(seasonVerdict(pack, 12).status).toBe("avoid");
    expect(seasonVerdict(pack, 8).status).toBe("off_season");
  });

  it("explains WHY in the best-time verdict", () => {
    expect(seasonVerdict(pack, 3).line).toContain("after the last frost");
  });

  it("carries a pack's own caveat on the 3-Ds line, not just the blanket sentence", () => {
    // Citrus is the documented exception: frost-damaged wood must NOT come off
    // straight away. A blanket "dead wood can come off any month" would hand a
    // grower permission the pack's own never-rule refuses — and it goes into
    // the model prompt too.
    expect(seasonVerdict(PRUNING_PACKS.citrus, 11).line).toContain("frost-damaged");

    // Generic, so it cannot be outlived by a new pack with its own caveat.
    for (const withCaveat of (Object.values(PRUNING_PACKS) as PruningPack[]).filter(
      (p) => p.alwaysAllowedCaveat,
    )) {
      for (let month = 1; month <= 12; month++) {
        const { line } = seasonVerdict(withCaveat, month);
        if (line.includes("can come off in any month")) {
          expect(line, `${withCaveat.key} m${month}`).toContain(withCaveat.alwaysAllowedCaveat!);
        }
      }
    }
  });

  it("always allows the safety exception, whatever the season says", () => {
    expect(seasonVerdict(pack, 12).line.toLowerCase()).toMatch(/dead|damaged|diseased|broken/);
  });

  it("rejects a month outside 1-12 instead of guessing", () => {
    expect(seasonVerdict(pack, 0).status).toBe("off_season");
    expect(seasonVerdict(pack, 13).status).toBe("off_season");
  });
});

describe("what the two features consume", () => {
  it("builds the prompt rules the pruning prompt expects", () => {
    const rules = promptRulesFor(plant(), 3);
    expect(rules.className).toBe("Citrus tree");
    expect(rules.seasonLine).toContain("Citrus tree");
    expect(rules.rules.length).toBeGreaterThan(0);
    expect(rules.never.length).toBeGreaterThan(0);
  });

  it("gives the chat a short, plain-language rule list including the season", () => {
    const rules = chatCareRules(plant(), 8);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.length).toBeLessThanOrEqual(6);
    expect(rules.some((rule) => /citrus tree/i.test(rule))).toBe(true);
    for (const rule of rules) expect(rule.length).toBeLessThanOrEqual(200);
  });
});
