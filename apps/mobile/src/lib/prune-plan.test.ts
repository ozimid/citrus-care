import { describe, expect, it } from "vitest";
import {
  MARKS_CAVEAT,
  MARKS_FIRST_RUN_NOTICE,
  MAX_CUTS,
  PRUNE_ANALYSIS_FAILED_ERROR,
  PRUNE_TIMEOUT_ERROR,
  PRUNE_UNAVAILABLE_ERROR,
  PRUNE_UNREADABLE_ERROR,
  PRUNE_USER_PROMPT,
  buildPrunePromptSystem,
  friendlyPruneError,
  EDGE_MARGIN,
  drawableMarkCount,
  haloBox,
  parsePrunePlanOutput,
  placeMark,
  type PrunePromptRules,
} from "./prune-plan";

const RULES: PrunePromptRules = {
  className: "Rose",
  seasonLine: "Late August: deadhead only — save the hard prune for late winter.",
  rules: [
    "Cut 5 mm above an outward-facing bud eye, sloping away from it.",
    "Remove canes thinner than a pencil.",
  ],
  never: ["Never leave a stub above the bud eye — it dies back."],
};

function plan(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    summary: "Three canes cross the middle of the bush.",
    subject: "plant",
    confidence: "medium",
    cuts: [
      { label: "Crossing cane", action: "Cut here", reason: "It rubs the neighbour", priority: 2, x: 30, y: 40 },
      { label: "Dead tip", action: "Cut back to green", reason: "Dieback", priority: 1, x: 70, y: 20 },
    ],
    general_steps: ["Wipe the blades with alcohol between plants."],
    ...overrides,
  });
}

describe("prune prompt carries this plant's rules", () => {
  it("names the class, the season line and every rule", () => {
    const prompt = buildPrunePromptSystem(RULES);
    expect(prompt).toContain("Rose");
    expect(prompt).toContain("Late August: deadhead only");
    for (const rule of [...RULES.rules, ...RULES.never]) expect(prompt).toContain(rule);
  });

  it("asks for boxes in the model's own trained convention", () => {
    // Gemma 4 is trained to emit {"box_2d": [y_min, x_min, y_max, x_max]} as
    // integers on a 1000x1000 grid, y FIRST. Percentages and 0-1 floats are
    // off-distribution (docs/research/pruning-rules.md).
    const prompt = buildPrunePromptSystem(RULES);
    expect(prompt).toContain("box_2d");
    expect(prompt).toContain("1000");
    expect(prompt).toContain("y_min");
    expect(prompt.toLowerCase()).toContain("top edge");
    expect(prompt.toLowerCase()).toContain("left edge");
  });

  it("asks for at most three boxes — the tier's documented limit", () => {
    expect(buildPrunePromptSystem(RULES)).toMatch(/at most 3|no more than 3/i);
  });

  it("tells the model to return no cuts rather than invent them", () => {
    const prompt = buildPrunePromptSystem(RULES).toLowerCase();
    expect(prompt).toContain("empty");
    expect(prompt).toMatch(/do not invent|never invent/);
  });

  it("asks for JSON only", () => {
    expect(buildPrunePromptSystem(RULES)).toContain("JSON");
    expect(PRUNE_USER_PROMPT.length).toBeGreaterThan(0);
  });
});

describe("parsePrunePlanOutput — the trained box_2d convention", () => {
  it("parses box_2d (y-first, 0-1000) and derives the centre of the box", () => {
    const result = parsePrunePlanOutput(
      plan({
        cuts: [{ label: "A", action: "Cut", reason: "Why", priority: 1, box_2d: [200, 400, 400, 600] }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // y 200-400 -> 20-40% down, centre 30%; x 400-600 -> 40-60% across, centre 50%.
    expect(result.plan.cuts[0]).toMatchObject({ x: 50, y: 30 });
    expect(result.plan.cuts[0].box).toEqual({ top: 20, left: 40, bottom: 40, right: 60 });
  });

  // The mark is the aid, the sentence is the instruction — so an untrustworthy
  // box costs the MARKER, never the advice. Dropping the whole cut would delete
  // correct guidance because a coordinate was wrong.
  it("keeps the advice but refuses to place it when the box is inverted", () => {
    const result = parsePrunePlanOutput(
      plan({
        cuts: [
          { label: "Bad box", action: "Cut it", reason: "Why", priority: 1, box_2d: [400, 400, 200, 600] },
          { label: "Good", action: "Cut", reason: "Why", priority: 2, box_2d: [100, 100, 300, 300] },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts.map((c) => c.label)).toEqual(["Bad box", "Good"]);
    const unplaced = result.plan.cuts[0];
    expect(unplaced.action).toBe("Cut it");
    expect(unplaced.x).toBeUndefined();
    expect(unplaced.y).toBeUndefined();
    expect(unplaced.box).toBeUndefined();
    expect(result.dropped).toBe(1);
  });

  it("keeps the advice when the box swallows most of the photo", () => {
    // A 2B model's classic miss is one huge box over the whole quadrant. Not
    // drawable — but "remove the crossing branch" is still worth reading.
    const result = parsePrunePlanOutput(
      plan({
        cuts: [{ label: "Everything", action: "Cut", reason: "Why", priority: 1, box_2d: [0, 0, 900, 900] }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts).toHaveLength(1);
    expect(result.plan.cuts[0].x).toBeUndefined();
    expect(result.dropped).toBe(1);
  });

  // All four values <= 100 is ambiguous between the 0-1000 grid we asked for
  // and percentages. Read on the grid it becomes a small box pinned near the
  // top-left corner — confident-looking and wrong, the one outcome the design
  // ranks worst. An area floor alone does not catch it: a 50%x40% percent box
  // reads as 5%x4%, which is well clear of any sane floor.
  it.each([
    [[10, 20, 30, 40], "small percent box"],
    [[20, 20, 70, 60], "large percent box — an area floor would let this through"],
    [[0, 0, 100, 100], "whole-image percent box"],
  ])("refuses an ambiguous box written in the wrong units: %j (%s)", (box) => {
    const result = parsePrunePlanOutput(
      plan({ cuts: [{ label: "A", action: "Cut", reason: "Why", priority: 1, box_2d: box }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts[0].x).toBeUndefined();
    expect(result.dropped).toBe(1);
  });

  it("still accepts a box that is unambiguously on the 0-1000 grid", () => {
    const result = parsePrunePlanOutput(
      plan({ cuts: [{ label: "A", action: "Cut", reason: "Why", priority: 1, box_2d: [200, 400, 400, 600] }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts[0].x).toBe(50);
  });

  it("keeps a tight box", () => {
    const result = parsePrunePlanOutput(
      plan({ cuts: [{ label: "A", action: "Cut", reason: "Why", priority: 1, box_2d: [500, 500, 560, 580] }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts).toHaveLength(1);
  });

  it("rejects a box_2d that is not exactly four numbers", () => {
    // A short array would otherwise destructure to undefined, and a long one
    // would silently use its first four values as if they were the box.
    for (const box of [[10], [200, 400, 400], [200, 400, 400, 600, 800]]) {
      const result = parsePrunePlanOutput(
        plan({ cuts: [{ label: "A", action: "Cut", reason: "Why", priority: 1, box_2d: box }] }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.plan.cuts[0].x, JSON.stringify(box)).toBeUndefined();
    }
  });

  it.each([
    [[500, 500, 502, 503], "a degenerate sliver — a 2px halo with an arrow on it is a crosshair"],
    [[200, 400, 400, 1600], "a value off the 0-1000 grid"],
    ["middle branch", "not an array at all"],
  ])("refuses %j (%s)", (box: unknown, _why: string) => {
    const result = parsePrunePlanOutput(
      plan({ cuts: [{ label: "A", action: "Cut", reason: "Why", priority: 1, box_2d: box }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts[0].action).toBe("Cut");
    expect(result.plan.cuts[0].x).toBeUndefined();
    expect(result.dropped).toBe(1);
  });

  it("still accepts a bare x/y point when the model ignores the box format", () => {
    const result = parsePrunePlanOutput(
      plan({ cuts: [{ label: "A", action: "Cut", reason: "Why", priority: 1, x: 30, y: 60 }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts[0]).toMatchObject({ x: 30, y: 60 });
    expect(result.plan.cuts[0].box).toBeUndefined();
  });
});

describe("parsePrunePlanOutput", () => {
  it("parses a clean plan and orders cuts by priority", () => {
    const result = parsePrunePlanOutput(plan());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts.map((c) => c.label)).toEqual(["Dead tip", "Crossing cane"]);
    expect(result.plan.summary).toBe("Three canes cross the middle of the bush.");
    expect(result.plan.general_steps).toHaveLength(1);
    expect(result.dropped).toBe(0);
  });

  it("survives prose and markdown fences around the JSON", () => {
    const wrapped = "Sure! Here is the plan:\n```json\n" + plan() + "\n```\nHope that helps.";
    expect(parsePrunePlanOutput(wrapped).ok).toBe(true);
  });

  it("defaults the optional fields instead of losing the plan", () => {
    const result = parsePrunePlanOutput(
      JSON.stringify({ summary: "Nothing to cut yet.", cuts: [] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts).toEqual([]);
    expect(result.plan.general_steps).toEqual([]);
  });

  it("accepts the 0-1000 coordinate convention and rescales it", () => {
    const result = parsePrunePlanOutput(
      plan({ cuts: [{ label: "A", action: "Cut", reason: "Why", priority: 1, x: 500, y: 250 }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts[0].x).toBe(50);
    expect(result.plan.cuts[0].y).toBe(25);
  });

  it("accepts fractional 0-1 coordinates and rescales them", () => {
    const result = parsePrunePlanOutput(
      plan({ cuts: [{ label: "A", action: "Cut", reason: "Why", priority: 1, x: 0.25, y: 0.5 }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts[0].x).toBe(25);
    expect(result.plan.cuts[0].y).toBe(50);
  });

  it("accepts numeric strings", () => {
    const result = parsePrunePlanOutput(
      plan({ cuts: [{ label: "A", action: "Cut", reason: "Why", priority: "2", x: "30", y: "60" }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts[0]).toMatchObject({ x: 30, y: 60, priority: 2 });
  });

  it("keeps an unplaceable cut's advice but strips its coordinates", () => {
    const result = parsePrunePlanOutput(
      plan({
        cuts: [
          { label: "Bad", action: "Cut", reason: "Why", priority: 1, x: -4, y: 20 },
          { label: "NaN", action: "Cut", reason: "Why", priority: 1, x: "over there", y: 20 },
          { label: "Good", action: "Cut", reason: "Why", priority: 2, x: 40, y: 40 },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts.map((c) => c.label)).toEqual(["Bad", "NaN", "Good"]);
    expect(result.plan.cuts.filter((c) => c.x !== undefined).map((c) => c.label)).toEqual(["Good"]);
    expect(result.dropped).toBe(2);
  });

  // Priority is horticultural importance; having coordinates is luck. A
  // priority-1 cut is not evicted by a priority-2 one just because the latter
  // could be drawn.
  it("keeps the highest-priority cuts when trimming, placeable or not", () => {
    const result = parsePrunePlanOutput(
      plan({
        cuts: [
          { label: "P1 unplaceable", action: "Cut", reason: "Why", priority: 1, x: -4, y: 20 },
          { label: "P1 also", action: "Cut", reason: "Why", priority: 1, x: 5000, y: 20 },
          { label: "P1 third", action: "Cut", reason: "Why", priority: 1, x: "nope", y: 20 },
          { label: "P2 placeable", action: "Cut", reason: "Why", priority: 2, x: 40, y: 40 },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts.map((c) => c.label)).toEqual(["P1 unplaceable", "P1 also", "P1 third"]);
  });

  it("keeps a plan whose marks were ALL unplaceable — the text still helps", () => {
    const result = parsePrunePlanOutput(
      plan({ cuts: [{ label: "Bad", action: "Cut", reason: "Why", priority: 1, x: -1, y: -1 }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts).toHaveLength(1);
    expect(result.plan.cuts[0].x).toBeUndefined();
    expect(result.plan.summary).toContain("cross");
  });

  // Priority decides first; among EQUAL priorities a cut we can draw beats one
  // we cannot, so the three that survive the trim are the three most useful.
  it("prefers placeable cuts when trimming a tie", () => {
    const result = parsePrunePlanOutput(
      plan({
        cuts: [
          { label: "Unplaceable", action: "Cut", reason: "Why", priority: 2, x: -4, y: 20 },
          { label: "A", action: "Cut", reason: "Why", priority: 2, x: 10, y: 20 },
          { label: "B", action: "Cut", reason: "Why", priority: 2, x: 20, y: 30 },
          { label: "C", action: "Cut", reason: "Why", priority: 2, x: 30, y: 40 },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts.map((c) => c.label)).toEqual(["A", "B", "C"]);
    expect(result.plan.cuts.every((c) => c.x !== undefined)).toBe(true);
  });

  it("holds the model to the three cuts it was asked for", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      label: `Cut ${i}`, action: "Cut", reason: "Why", priority: 2, x: 10 + i, y: 20,
    }));
    const result = parsePrunePlanOutput(
      plan({ cuts: many, general_steps: ["a", "b", "c", "d", "e", "f"] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts).toHaveLength(MAX_CUTS);
    expect(MAX_CUTS).toBe(3);
    expect(result.plan.general_steps.length).toBeLessThanOrEqual(4);
  });

  it("truncates over-long text instead of rejecting the plan", () => {
    const result = parsePrunePlanOutput(
      plan({
        summary: "s".repeat(900),
        cuts: [{ label: "L".repeat(200), action: "A".repeat(900), reason: "R".repeat(900), priority: 1, x: 10, y: 10 }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.summary.length).toBeLessThanOrEqual(400);
    expect(result.plan.cuts[0].label.length).toBeLessThanOrEqual(60);
  });

  it("clamps a nonsense priority into the 1-3 band", () => {
    const result = parsePrunePlanOutput(
      plan({ cuts: [{ label: "A", action: "Cut", reason: "Why", priority: 9, x: 10, y: 10 }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cuts[0].priority).toBe(3);
  });

  it("drops an unrecognized subject or confidence rather than failing", () => {
    const result = parsePrunePlanOutput(plan({ subject: "banana", confidence: "very sure" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.subject).toBeUndefined();
    expect(result.plan.confidence).toBeUndefined();
  });

  it("reports why it could not parse", () => {
    expect(parsePrunePlanOutput("I cannot help with that.")).toEqual({ ok: false, reason: "no-json" });
    expect(parsePrunePlanOutput("{ nope: }")).toEqual({ ok: false, reason: "invalid-json" });
    expect(parsePrunePlanOutput(JSON.stringify({ cuts: [] }))).toEqual({
      ok: false,
      reason: "schema-mismatch",
    });
  });

  it("passes a not_a_plant reading through so the screen can say so", () => {
    const result = parsePrunePlanOutput(
      JSON.stringify({ summary: "This is a keyboard.", subject: "not_a_plant", cuts: [] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.subject).toBe("not_a_plant");
  });
});

describe("haloBox — the region a mark occupies", () => {
  it("uses the model's own box when it gave one", () => {
    expect(haloBox({ x: 50, y: 30, box: { top: 20, left: 40, bottom: 40, right: 60 } })).toEqual({
      top: 20,
      left: 40,
      bottom: 40,
      right: 60,
    });
  });

  it("falls back to a generous halo around a bare point — a point carries no size signal", () => {
    const box = haloBox({ x: 50, y: 50 });
    expect(box.right - box.left).toBeGreaterThan(8);
    expect(box.bottom - box.top).toBeGreaterThan(8);
    expect((box.left + box.right) / 2).toBeCloseTo(50);
  });

  it("clamps a fallback halo that would run off the photo", () => {
    const box = haloBox({ x: 1, y: 1 });
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(haloBox({ x: 99, y: 99 }).right).toBeLessThanOrEqual(100);
    expect(haloBox({ x: 99, y: 99 }).bottom).toBeLessThanOrEqual(100);
  });
});

describe("placeMark — the arrow points AT the region, never into it", () => {
  it("approaches from the side with room", () => {
    expect(placeMark({ x: 90, y: 50 }).side).toBe("left");
    expect(placeMark({ x: 10, y: 50 }).side).toBe("right");
  });

  // The tip stops at the region's edge. Landing it on the centre would make
  // the arrow a crosshair, which is the precision claim D-P3 refuses.
  it("stops the arrow at the edge of the region, not at its centre", () => {
    const fromLeft = placeMark({ x: 20, y: 50, box: { top: 40, left: 10, bottom: 60, right: 30 } });
    expect(fromLeft.side).toBe("right");
    expect(fromLeft.tipX).toBe(30);

    const fromRight = placeMark({ x: 80, y: 50, box: { top: 40, left: 70, bottom: 60, right: 90 } });
    expect(fromRight.side).toBe("left");
    expect(fromRight.tipX).toBe(70);
  });

  it("centres the arrow on the region vertically", () => {
    expect(placeMark({ x: 50, y: 30, box: { top: 20, left: 40, bottom: 40, right: 60 } }).tipY).toBe(30);
  });

  it("keeps the tip inside a REAL margin, not merely on the canvas", () => {
    // Asserting 0..100 would pass with no margin at all, which is how a mark at
    // the very edge ends up with its badge clipped off the photo.
    expect(EDGE_MARGIN).toBeGreaterThan(0);
    const topLeft = placeMark({ x: 0, y: 0 });
    expect(topLeft.tipX).toBeGreaterThanOrEqual(EDGE_MARGIN);
    expect(topLeft.tipY).toBeGreaterThanOrEqual(EDGE_MARGIN);
    const bottomRight = placeMark({ x: 100, y: 100 });
    expect(bottomRight.tipX).toBeLessThanOrEqual(100 - EDGE_MARGIN);
    expect(bottomRight.tipY).toBeLessThanOrEqual(100 - EDGE_MARGIN);
  });
});

// This rule has had two bugs (the one-time notice fired on a plan that drew
// nothing; the per-row "not marked" note repeated once per cut). It decides
// what the user is told about the photo, so it belongs in a tested module
// rather than inline in a screen.
describe("drawableMarkCount — what is actually ON the photo", () => {
  function withCuts(cuts: unknown[], subject?: string) {
    const parsed = parsePrunePlanOutput(
      JSON.stringify({ summary: "s", ...(subject ? { subject } : {}), cuts }),
    );
    if (!parsed.ok) throw new Error("fixture did not parse");
    return parsed.plan;
  }

  const placeable = { label: "A", action: "Cut", reason: "Why", priority: 1, x: 40, y: 40 };
  const unplaceable = { label: "B", action: "Cut", reason: "Why", priority: 1, x: -5, y: 40 };

  it("counts only the cuts that carry a location", () => {
    expect(drawableMarkCount(withCuts([placeable, unplaceable]))).toBe(1);
    expect(drawableMarkCount(withCuts([placeable, { ...placeable, label: "C" }]))).toBe(2);
  });

  it("is zero when every cut lost its location", () => {
    expect(drawableMarkCount(withCuts([unplaceable]))).toBe(0);
  });

  it("is zero when the model said it could not read the photo, whatever it returned", () => {
    // Believing "unclear" is the point of asking for it: nothing is drawn even
    // though these coordinates would otherwise be usable.
    expect(drawableMarkCount(withCuts([placeable, placeable], "unclear"))).toBe(0);
  });

  it("is zero for a plan with no cuts at all", () => {
    expect(drawableMarkCount(withCuts([]))).toBe(0);
  });
});

describe("errors and caveat", () => {
  it("passes the flow's own honest strings through", () => {
    for (const message of [
      PRUNE_UNAVAILABLE_ERROR,
      PRUNE_ANALYSIS_FAILED_ERROR,
      PRUNE_UNREADABLE_ERROR,
      PRUNE_TIMEOUT_ERROR,
    ]) {
      expect(friendlyPruneError(new Error(message))).toBe(message);
    }
  });

  it("never leaks a raw runtime message", () => {
    expect(friendlyPruneError(new Error("vulkan device lost 0xdeadbeef"))).not.toContain("vulkan");
  });

  // Research (docs/research/pruning-rules.md) is explicit: at this model tier a
  // precise "cut here" claim is not supportable, so the copy must offer a
  // likely AREA and hand the decision back to the grower.
  it("offers a likely area rather than an exact cut", () => {
    const caveat = MARKS_CAVEAT.toLowerCase();
    expect(caveat).toContain("likely area");
    expect(caveat).not.toContain("cut here");
    expect(caveat).toMatch(/yourself|check/);
  });

  it("discloses once, in plain words, that the estimate can be wrong", () => {
    expect(MARKS_FIRST_RUN_NOTICE.toLowerCase()).toContain("can be wrong");
    expect(MARKS_FIRST_RUN_NOTICE.toLowerCase()).toMatch(/before you cut|confirm/);
  });
});
