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
});
