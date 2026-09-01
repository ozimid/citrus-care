import { describe, expect, it } from "vitest";
import { todayDigest } from "./today-digest";

// #8 (honest v1): the Today lines carry their KIND so the screen can make the
// most urgent thing look like it (designer finding: the ranking existed only
// in source order). A frost line names EVERY plant — the card is the only
// surface that carries those names, and recall-with-a-dead-plant-as-cost is
// not a trade we make for one saved row.
describe("todayDigest", () => {
  it("ranks alert > water > prune and types each line", () => {
    const lines = todayDigest({
      alert: { kind: "frost", tempC: -2, plantNames: ["Mr Lemon"] },
      dueWater: ["Rosa", "Kumquat"],
      pruneWindowOpen: ["Rosa"],
    });
    expect(lines.map((l) => l.kind)).toEqual(["alert", "water", "prune"]);
    expect(lines[0].text).toContain("Frost");
    expect(lines[0].text).toContain("Mr Lemon");
    expect(lines[1].text).toContain("Kumquat");
  });

  it("never truncates the alert's plant names", () => {
    const lines = todayDigest({
      alert: { kind: "frost", tempC: -1, plantNames: ["A", "B", "C", "D", "E"] },
      dueWater: [],
      pruneWindowOpen: [],
    });
    expect(lines[0].text).toContain("E");
    expect(lines[0].text).not.toContain("more");
  });

  it("still truncates the calmer lines", () => {
    const lines = todayDigest({ alert: null, dueWater: ["A", "B", "C", "D", "E"], pruneWindowOpen: [] });
    expect(lines[0].text).toContain("+2 more");
  });

  it("is empty when nothing needs doing", () => {
    expect(todayDigest({ alert: null, dueWater: [], pruneWindowOpen: [] })).toEqual([]);
  });
});
