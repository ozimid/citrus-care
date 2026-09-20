import { describe, expect, it } from "vitest";
import type { NewPlantInput } from "@citrus/shared";
import { buildPlantUpdateRow } from "./plant-mutations";

// D-17: the update write and delete cascade are thin AsyncStorage orchestration
// (plants-io.ts, untested by policy). The one pure piece is the field mapping.

const input: NewPlantInput = {
  name: "Mr Lemon",
  plant_type: "tree",
  species: "Citrus limon",
  cultivar: null,
  location: null,
  zip_code: "92866",
};

describe("buildPlantUpdateRow", () => {
  it("maps the editable fields, null for absent optionals, never id/created_at/care_profile", () => {
    expect(buildPlantUpdateRow(input)).toEqual({
      name: "Mr Lemon",
      plant_type: "tree",
      species: "Citrus limon",
      cultivar: null,
      location: null,
      zip_code: "92866",
    });
    expect(buildPlantUpdateRow({ name: "X", plant_type: "herb" })).toEqual({
      name: "X",
      plant_type: "herb",
      species: null,
      cultivar: null,
      location: null,
      zip_code: null,
    });
  });

  // F39: the tag is edited on the same sheet. It is written normalized, null
  // clears it, and an input with NO tag field leaves the stored tag alone —
  // so a caller that only edits the name can never wipe a stake number.
  it("threads the tag: normalized when given, null to clear, absent to keep", () => {
    expect(buildPlantUpdateRow({ ...input, tag: " l3 " }).tag).toBe("L3");
    expect(buildPlantUpdateRow({ ...input, tag: null }).tag).toBeNull();
    expect(buildPlantUpdateRow({ ...input, tag: "" }).tag).toBeNull();
    expect("tag" in buildPlantUpdateRow(input)).toBe(false);
    expect("tag" in buildPlantUpdateRow({ name: "X", plant_type: "herb" })).toBe(false);
  });

  it("never touches codes, tag_photo or tag_missing — those change only from the Tags card", () => {
    const row = buildPlantUpdateRow({ ...input, tag: "L3" }) as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["cultivar", "location", "name", "plant_type", "species", "tag", "zip_code"]);
  });
});
