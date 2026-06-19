import { describe, expect, it } from "vitest";
import { newPlantSchema, CITRUS_CULTIVARS, PLANT_TYPES } from "@/app/_lib/plant-schemas";

describe("newPlantSchema", () => {
  it("accepts minimal valid plant (name + plant_type)", () => {
    const r = newPlantSchema.safeParse({ name: "Lemon by the porch", plant_type: "tree" });
    expect(r.success).toBe(true);
  });

  it("accepts a plant with cultivar + location + species + zip_code", () => {
    const r = newPlantSchema.safeParse({
      name: "Mr Lemon",
      plant_type: "tree",
      species: "Citrus limon",
      cultivar: "Meyer Lemon",
      location: "South patio",
      zip_code: "94043",
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(newPlantSchema.safeParse({ name: "", plant_type: "tree" }).success).toBe(false);
    expect(newPlantSchema.safeParse({ name: "   ", plant_type: "tree" }).success).toBe(false);
  });

  it("rejects invalid plant_type", () => {
    expect(newPlantSchema.safeParse({ name: "Rose", plant_type: "invalid" }).success).toBe(false);
  });

  it("rejects name > 80 chars", () => {
    expect(newPlantSchema.safeParse({ name: "a".repeat(81), plant_type: "tree" }).success).toBe(false);
  });

  it("trims and normalises name", () => {
    const r = newPlantSchema.safeParse({ name: "  Sunny  ", plant_type: "tree" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Sunny");
  });

  it("includes a non-empty citrus cultivar list", () => {
    expect(CITRUS_CULTIVARS.length).toBeGreaterThan(5);
    expect(CITRUS_CULTIVARS).toContain("Meyer Lemon");
  });

  it("includes expected plant types", () => {
    expect(PLANT_TYPES).toContain("tree");
    expect(PLANT_TYPES).toContain("flower");
    expect(PLANT_TYPES).toContain("succulent");
  });
});
