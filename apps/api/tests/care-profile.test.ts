import { describe, expect, it, vi, beforeEach } from "vitest";

// F20: POST /care-profile generates a plant's care baseline with ONE Gemini
// text call, ever. Same boundaries as /assess — auth, rate limit, RLS plant
// lookup, Zod-validated model output, generic client errors.

const createClientMock = vi.fn();
const generateCareProfileMock = vi.fn();

vi.mock("../src/auth", () => ({
  getAuth: async () => {
    const supabase = await createClientMock();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    return { supabase, user };
  },
}));

vi.mock("../src/gemini", async () => {
  const real = await vi.importActual<typeof import("../src/gemini")>("../src/gemini");
  return {
    ...real,
    generateCareProfile: (...args: unknown[]) => generateCareProfileMock(...args),
  };
});

import app from "../src/index";

const CARE_PROFILE = {
  base_watering_interval_days: 10,
  water_amount_note: "About 2L until it drains.",
  sun: "full",
  temp_min_c: -2,
  temp_max_c: 32,
  drought_tolerance: "medium",
  indoor_ok: false,
  notes: "Deep soak, then let the top few cm dry back.",
};

const PLANT = {
  id: "p1",
  user_id: "u1",
  name: "Mr Lemon",
  plant_type: "tree",
  species: "Citrus limon",
  cultivar: "Meyer Lemon",
  location: "South patio",
  zip_code: "90210",
  care_profile: null,
};

function buildSupabaseStub(opts: {
  user?: { id: string } | null;
  plant?: Record<string, unknown> | null;
  updateSpy?: ReturnType<typeof vi.fn>;
  updateError?: { message: string } | null;
  rateLimit?: { count: number; allowed: boolean; retry_after_sec: number };
}) {
  const user = "user" in opts ? opts.user : { id: "u1" };
  const rl = opts.rateLimit ?? { count: 1, allowed: true, retry_after_sec: 0 };
  const update =
    opts.updateSpy ??
    vi.fn().mockReturnValue({
      eq: () => Promise.resolve({ error: opts.updateError ?? null }),
    });
  return {
    rpc: vi.fn().mockImplementation((fn: string) => {
      if (fn === "consume_rate_limit") return Promise.resolve({ data: [rl], error: null });
      return Promise.resolve({ data: null, error: null });
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "plants") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: opts.plant, error: null }),
            }),
          }),
          update,
        };
      }
      return {};
    }),
  };
}

function req(payload: object) {
  return new Request("http://localhost/care-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  createClientMock.mockReset();
  generateCareProfileMock.mockReset();
});

describe("POST /care-profile", () => {
  it("returns 401 when not authenticated (and never calls Gemini)", async () => {
    createClientMock.mockResolvedValue(buildSupabaseStub({ user: null, plant: PLANT }));
    const res = await app.request(req({ plantId: "p1" }));
    expect(res.status).toBe(401);
    expect(generateCareProfileMock).not.toHaveBeenCalled();
  });

  it("returns 400 when plantId is missing", async () => {
    createClientMock.mockResolvedValue(buildSupabaseStub({ plant: PLANT }));
    const res = await app.request(req({}));
    expect(res.status).toBe(400);
    expect(generateCareProfileMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the plant is not visible to this user (RLS)", async () => {
    createClientMock.mockResolvedValue(buildSupabaseStub({ plant: null }));
    const res = await app.request(req({ plantId: "someone-elses" }));
    expect(res.status).toBe(404);
    expect(generateCareProfileMock).not.toHaveBeenCalled();
  });

  it("generates the profile, persists it on the plant row, and returns it", async () => {
    generateCareProfileMock.mockResolvedValue({
      careProfile: CARE_PROFILE,
      raw: JSON.stringify(CARE_PROFILE),
    });
    const updateSpy = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
    createClientMock.mockResolvedValue(buildSupabaseStub({ plant: PLANT, updateSpy }));

    const res = await app.request(req({ plantId: "p1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ careProfile: CARE_PROFILE });

    // The model only ever sees plant identity — no watering decision.
    expect(generateCareProfileMock).toHaveBeenCalledOnce();
    expect(generateCareProfileMock.mock.calls[0][0]).toMatchObject({
      name: "Mr Lemon",
      species: "Citrus limon",
      cultivar: "Meyer Lemon",
    });

    expect(updateSpy).toHaveBeenCalledOnce();
    expect(updateSpy.mock.calls[0][0]).toEqual({ care_profile: CARE_PROFILE });
  });

  it("one Gemini call per plant EVER: an existing profile is returned as-is", async () => {
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ plant: { ...PLANT, care_profile: CARE_PROFILE } }),
    );
    const res = await app.request(req({ plantId: "p1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ careProfile: CARE_PROFILE });
    expect(generateCareProfileMock).not.toHaveBeenCalled();
  });

  it("regenerates when the stored profile is corrupt rather than serving junk", async () => {
    generateCareProfileMock.mockResolvedValue({
      careProfile: CARE_PROFILE,
      raw: JSON.stringify(CARE_PROFILE),
    });
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ plant: { ...PLANT, care_profile: { base_watering_interval_days: 999 } } }),
    );
    const res = await app.request(req({ plantId: "p1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ careProfile: CARE_PROFILE });
    expect(generateCareProfileMock).toHaveBeenCalledOnce();
  });

  it("returns 429 with Retry-After when rate limited (does NOT call Gemini)", async () => {
    createClientMock.mockResolvedValue(
      buildSupabaseStub({
        plant: PLANT,
        rateLimit: { count: 11, allowed: false, retry_after_sec: 900 },
      }),
    );
    const res = await app.request(req({ plantId: "p1" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("900");
    expect((await res.json()) as { retryAfter?: number }).toMatchObject({ retryAfter: 900 });
    expect(generateCareProfileMock).not.toHaveBeenCalled();
  });

  it("consumes its own rate-limit bucket, not the assess one", async () => {
    generateCareProfileMock.mockResolvedValue({
      careProfile: CARE_PROFILE,
      raw: JSON.stringify(CARE_PROFILE),
    });
    const stub = buildSupabaseStub({ plant: PLANT });
    createClientMock.mockResolvedValue(stub);
    await app.request(req({ plantId: "p1" }));
    expect(stub.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      _key: "care-profile",
      _limit: 10,
      _window_sec: 3600,
    });
  });

  it("returns a generic 502 when Gemini fails (no internal details leaked)", async () => {
    generateCareProfileMock.mockRejectedValue(
      new Error("Internal: API key abc123 invalid; quota exhausted at https://gen-lang/v1beta"),
    );
    createClientMock.mockResolvedValue(buildSupabaseStub({ plant: PLANT }));
    const res = await app.request(req({ plantId: "p1" }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: string };
    expect(body.error).not.toContain("API key");
    expect(body.error).not.toContain("abc123");
    expect(body.error).not.toContain("gen-lang");
  });

  it("returns a generic 500 when the update fails (no Supabase message leaked)", async () => {
    generateCareProfileMock.mockResolvedValue({
      careProfile: CARE_PROFILE,
      raw: JSON.stringify(CARE_PROFILE),
    });
    createClientMock.mockResolvedValue(
      buildSupabaseStub({
        plant: PLANT,
        updateError: { message: "column care_profile does not exist — table: public.plants" },
      }),
    );
    const res = await app.request(req({ plantId: "p1" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).not.toContain("care_profile does not exist");
    expect(body.error).not.toContain("public.plants");
  });
});
