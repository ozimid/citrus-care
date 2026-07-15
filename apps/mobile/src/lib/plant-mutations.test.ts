import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewPlantInput } from "@citrus/shared";
import type { AuthorizedFetch } from "./api";
import {
  buildPlantUpdateRow,
  deletePlantWithPhotos,
  GENERIC_DELETE_PLANT_ERROR,
  GENERIC_UPDATE_PLANT_ERROR,
  photoPrefix,
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
  it("mirrors the web updatePlant field mapping (nulls for absent optionals, no user_id)", () => {
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
  opts: { user: { id: string } | null; deleteError?: { message: string } | null },
): SupabaseClient {
  return {
    auth: {
      getUser: async () => ({ data: { user: opts.user } }),
    },
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

function fakeApi(order: string[], paths: string[], fail = false): AuthorizedFetch {
  return async (path, init) => {
    order.push("photos-delete");
    paths.push(`${init?.method ?? "GET"} ${path}`);
    if (fail) throw new Error("network down");
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

describe("photoPrefix", () => {
  it("is the user-scoped storage prefix the API ownership check expects", () => {
    expect(photoPrefix("u-1", "p-1")).toBe("u-1/p-1/");
  });
});

describe("deletePlantWithPhotos", () => {
  it("deletes photos (best-effort) before the plants row, with the encoded prefix", async () => {
    const order: string[] = [];
    const paths: string[] = [];
    await deletePlantWithPhotos(
      { client: fakeDeleteClient(order, { user: { id: "u-1" } }), api: fakeApi(order, paths) },
      "p-1",
    );
    expect(order).toEqual(["photos-delete", "row-delete"]);
    expect(paths).toEqual([`DELETE /photos?prefix=${encodeURIComponent("u-1/p-1/")}`]);
  });

  it("still deletes the row when photo cleanup fails (best-effort, web parity)", async () => {
    const order: string[] = [];
    await deletePlantWithPhotos(
      { client: fakeDeleteClient(order, { user: { id: "u-1" } }), api: fakeApi(order, [], true) },
      "p-1",
    );
    expect(order).toEqual(["photos-delete", "row-delete"]);
  });

  it("maps a row-delete failure to the generic string", async () => {
    const order: string[] = [];
    await expect(
      deletePlantWithPhotos(
        {
          client: fakeDeleteClient(order, { user: { id: "u-1" }, deleteError: { message: "boom" } }),
          api: fakeApi(order, []),
        },
        "p-1",
      ),
    ).rejects.toThrow(GENERIC_DELETE_PLANT_ERROR);
  });

  it("fails generically without an authenticated user and never calls the API", async () => {
    const order: string[] = [];
    await expect(
      deletePlantWithPhotos(
        { client: fakeDeleteClient(order, { user: null }), api: fakeApi(order, []) },
        "p-1",
      ),
    ).rejects.toThrow(GENERIC_DELETE_PLANT_ERROR);
    expect(order).toEqual([]);
  });
});
