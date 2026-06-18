import { describe, expect, it } from "vitest";
import { newTreeSchema, CITRUS_CULTIVARS } from "@/app/_lib/tree-schemas";

describe("newTreeSchema", () => {
  it("accepts minimal valid tree (name only)", () => {
    const r = newTreeSchema.safeParse({ name: "Lemon by the porch" });
    expect(r.success).toBe(true);
  });

  it("accepts a tree with cultivar + location", () => {
    const r = newTreeSchema.safeParse({
      name: "Mr Lemon",
      cultivar: "Meyer Lemon",
      location: "South patio",
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(newTreeSchema.safeParse({ name: "" }).success).toBe(false);
    expect(newTreeSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects name > 80 chars", () => {
    expect(newTreeSchema.safeParse({ name: "a".repeat(81) }).success).toBe(false);
  });

  it("trims and normalises name", () => {
    const r = newTreeSchema.safeParse({ name: "  Sunny  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Sunny");
  });

  it("includes a non-empty citrus cultivar list", () => {
    expect(CITRUS_CULTIVARS.length).toBeGreaterThan(5);
    expect(CITRUS_CULTIVARS).toContain("Meyer Lemon");
  });
});
