import { describe, expect, it } from "vitest";
import { CAPTURE_HINT, SNAP_TIPS, SNAP_TIPS_SEEN_KEY, preselectedPlantId } from "./capture-modes";

// F21 deleted the three capture modes: classifying the photo was the user's
// job only because the prompt branched on it, and it manufactured false
// negatives (a tree shot in "Leaf" mode came back as "poor quality"). What
// survives is the photo-quality nudge the capture research earned — one hint,
// no classification.
describe("CAPTURE_HINT", () => {
  it("nudges for a close, filled frame without asking what the subject is", () => {
    // F35: the framing square was removed (it read as a crop preview and lied —
    // nothing is cropped). The hint now carries the guidance and the honesty.
    expect(CAPTURE_HINT).toMatch(/good light/i);
    expect(CAPTURE_HINT).toMatch(/whole photo|nothing gets cropped/i);
    expect(CAPTURE_HINT).not.toMatch(/leaf|whole plant|cut/i);
  });
});

describe("preselectedPlantId", () => {
  it("preselects the plant when the user has exactly one", () => {
    expect(preselectedPlantId([{ id: "p1" }])).toBe("p1");
  });

  it("forces an explicit choice when there are several", () => {
    expect(preselectedPlantId([{ id: "p1" }, { id: "p2" }])).toBeNull();
  });

  it("selects nothing when there are no plants", () => {
    expect(preselectedPlantId([])).toBeNull();
  });

  it("prefers an explicitly requested plant (detail screen's 'Assess this plant')", () => {
    expect(preselectedPlantId([{ id: "p1" }, { id: "p2" }], "p2")).toBe("p2");
  });

  it("ignores a preferred id that is not in the list", () => {
    expect(preselectedPlantId([{ id: "p1" }, { id: "p2" }], "p9")).toBeNull();
  });
});

// F36 (competitor-inspired): a one-time photo guide replaces the teaching the
// removed framing square never did. Content must stay honest (no cloud talk)
// and grounded in what actually helps the on-device model.
describe("SNAP_TIPS", () => {
  it("has three tips, each with glyph, title and body", () => {
    expect(SNAP_TIPS).toHaveLength(3);
    for (const tip of SNAP_TIPS) {
      expect(tip.glyph.length).toBeGreaterThan(0);
      expect(tip.title.length).toBeGreaterThan(0);
      expect(tip.body.length).toBeGreaterThan(10);
    }
  });

  it("covers the three things that matter: closeness, light, no cropping", () => {
    const all = SNAP_TIPS.map((t) => `${t.title} ${t.body}`).join(" ");
    expect(all).toMatch(/close/i);
    expect(all).toMatch(/light/i);
    expect(all).toMatch(/whole photo|not.*cropped|nothing.*cropped/i);
    expect(all).not.toMatch(/gemini|cloud|upload/i);
  });

  it("seen-flag key follows the store convention", () => {
    expect(SNAP_TIPS_SEEN_KEY).toBe("citrus.snap-tips-seen.v1");
  });
});
