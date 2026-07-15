import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewPlantInput } from "@citrus/shared";
import {
  buildPlantUpdateRow,
  deletePlantWithPhotos,
  GENERIC_DELETE_PLANT_ERROR,
  GENERIC_UPDATE_PLANT_ERROR,
  updatePlant,
} from "./plant-mutations";

const input: NewPlantInput = {
  name: "Mr Lemon",
  plant_type: "tree",
  species: "Citrus limon",
  cultivar: null,
  location: null,
  zip_code: "92866",
};

describe("buildPlantUpdateRow", () => {
  it("mirrors the historical web updatePlant field mapping (nulls for absent optionals, no user_id)", () => {
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

interface Call {
  op: string;
  args: unknown[];
}

function fakeUpdateClient(calls: Call[], error: { message: string } | null): SupabaseClient {
  return {
    from(table: string) {
      calls.push({ op: "from", args: [table] });
      return {
        update(row: unknown) {
          calls.push({ op: "update", args: [row] });
          return {
            eq(col: string, val: string) {
              calls.push({ op: "eq", args: [col, val] });
              return Promise.resolve({ error });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("updatePlant", () => {
  it("updates the plants row scoped by id (RLS handles ownership)", async () => {
    const calls: Call[] = [];
    await updatePlant(fakeUpdateClient(calls, null), "plant-1", input);
    expect(calls).toEqual([
      { op: "from", args: ["plants"] },
      { op: "update", args: [buildPlantUpdateRow(input)] },
      { op: "eq", args: ["id", "plant-1"] },
    ]);
  });

  it("maps failures to the generic user-facing string", async () => {
    const calls: Call[] = [];
    await expect(
      updatePlant(fakeUpdateClient(calls, { message: "boom" }), "plant-1", input),
    ).rejects.toThrow(GENERIC_UPDATE_PLANT_ERROR);
  });
});

function fakeDeleteClient(
  order: string[],
  opts: { deleteError?: { message: string } | null } = {},
): SupabaseClient {
  return {
    from(_table: string) {
      return {
        delete() {
          return {
            eq: async (_col: string, _val: string) => {
              order.push("row-delete");
              return { error: opts.deleteError ?? null };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

function fakeLocalCleanup(order: string[], plants: string[], fail = false) {
  return async (plantId: string) => {
    order.push("local-photos-delete");
    plants.push(plantId);
    if (fail) throw new Error("filesystem error: /data/user/0/...");
  };
}

// D-16: plant delete removes the phone-local photos (photo-store) and the
// plants row. No API photo call — the /photos route no longer exists.
describe("deletePlantWithPhotos", () => {
  it("deletes local photos (best-effort) before the plants row", async () => {
    const order: string[] = [];
    const plants: string[] = [];
    await deletePlantWithPhotos(
      { client: fakeDeleteClient(order), deleteLocalPhotos: fakeLocalCleanup(order, plants) },
      "p-1",
    );
    expect(order).toEqual(["local-photos-delete", "row-delete"]);
    expect(plants).toEqual(["p-1"]);
  });

  it("still deletes the row when local photo cleanup fails (best-effort)", async () => {
    const order: string[] = [];
    await deletePlantWithPhotos(
      { client: fakeDeleteClient(order), deleteLocalPhotos: fakeLocalCleanup(order, [], true) },
      "p-1",
    );
    expect(order).toEqual(["local-photos-delete", "row-delete"]);
  });

  it("maps a row-delete failure to the generic string", async () => {
    const order: string[] = [];
    await expect(
      deletePlantWithPhotos(
        {
          client: fakeDeleteClient(order, { deleteError: { message: "boom" } }),
          deleteLocalPhotos: fakeLocalCleanup(order, []),
        },
        "p-1",
      ),
    ).rejects.toThrow(GENERIC_DELETE_PLANT_ERROR);
  });
});
