import { describe, expect, it, vi, beforeEach } from "vitest";

const createClientMock = vi.fn();
const assessPhotoWithGeminiMock = vi.fn();

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
  const real = await vi.importActual<typeof import("../src/gemini")>(
    "../src/gemini",
  );
  return {
    ...real,
    assessPhotoWithGemini: (...args: unknown[]) => assessPhotoWithGeminiMock(...args),
  };
});

import app from "../src/index";

function buildSupabaseStub(opts: {
  user?: { id: string } | null;
  plant?: Record<string, unknown> | null;
  prev?: Record<string, unknown> | null;
  insertedId?: string;
  insertError?: { message: string } | null;
  insertSpy?: ReturnType<typeof vi.fn>;
  rateLimit?: { count: number; allowed: boolean; retry_after_sec: number };
}) {
  const user = "user" in opts ? opts.user : { id: "user-1" };
  const rl = opts.rateLimit ?? { count: 1, allowed: true, retry_after_sec: 0 };
  const insert =
    opts.insertSpy ??
    vi.fn().mockReturnValue({
      select: () => ({
        single: () =>
          Promise.resolve({
            data: opts.insertedId ? { id: opts.insertedId } : null,
            error: opts.insertError ?? null,
          }),
      }),
    });
  return {
    rpc: vi.fn().mockImplementation((fn: string) => {
      if (fn === "consume_rate_limit") {
        return Promise.resolve({ data: [rl], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "plants") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: opts.plant, error: null }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      }
      if (table === "assessments") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: opts.prev ?? null, error: null }),
                }),
              }),
            }),
          }),
          insert,
        };
      }
      return {};
    }),
  };
}

const PLANT = {
  id: "t1",
  user_id: "u1",
  name: "Mr Lemon",
  plant_type: "tree",
  species: null,
  cultivar: null,
  location: null,
  zip_code: null,
};

// A small but real JPEG-ish payload; content is irrelevant, size is what matters.
const SMALL_IMAGE_BASE64 = Buffer.from("fake-jpeg-bytes").toString("base64");

/** Base64 whose DECODED size exceeds the 3MB cap (decoded = len/4*3). */
const OVERSIZED_IMAGE_BASE64 = "A".repeat(4 * 1024 * 1024 + 4);

function body(overrides: Record<string, unknown> = {}) {
  return {
    plantId: "t1",
    imageBase64: SMALL_IMAGE_BASE64,
    mime: "image/jpeg",
    ...overrides,
  };
}

function req(payload: object) {
  return new Request("http://localhost/assess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function geminiOk(payload: Record<string, unknown>) {
  const raw = JSON.stringify(payload);
  return { diagnosis: payload, raw };
}

const DIAGNOSIS_OK = {
  health_score: 80,
  summary: "Looks healthy.",
  symptoms: [],
  causes: [],
  recommendations: [
    { priority: 1, action: "Water deeply weekly", detail: "Until drains." },
  ],
};

beforeEach(() => {
  createClientMock.mockReset();
  assessPhotoWithGeminiMock.mockReset();
});

describe("POST /assess (direct-image contract, D-16)", () => {
  it("returns 401 when not authenticated", async () => {
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: null, plant: PLANT }),
    );
    const res = await app.request(req(body()));
    expect(res.status).toBe(401);
  });

  it("returns 400 when the image is missing", async () => {
    createClientMock.mockResolvedValue(buildSupabaseStub({ plant: PLANT }));
    const res = await app.request(req({ plantId: "t1", mime: "image/jpeg" }));
    expect(res.status).toBe(400);
    expect(assessPhotoWithGeminiMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-jpeg mime", async () => {
    createClientMock.mockResolvedValue(buildSupabaseStub({ plant: PLANT }));
    const res = await app.request(req(body({ mime: "image/png" })));
    expect(res.status).toBe(400);
  });

  it("rejects an image over 3MB decoded with a 400 and a generic message", async () => {
    createClientMock.mockResolvedValue(buildSupabaseStub({ plant: PLANT }));
    const res = await app.request(
      req(body({ imageBase64: OVERSIZED_IMAGE_BASE64 })),
    );
    expect(res.status).toBe(400);
    const resBody = (await res.json()) as { error?: string };
    expect(resBody.error).toBe("Image too large. Please retry.");
    expect(assessPhotoWithGeminiMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the plant is not found", async () => {
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, plant: null }),
    );
    const res = await app.request(req(body()));
    expect(res.status).toBe(404);
  });

  it("sends the request image straight to Gemini, persists with photo_path null, returns the id", async () => {
    assessPhotoWithGeminiMock.mockResolvedValue(geminiOk(DIAGNOSIS_OK));
    const insertSpy = vi.fn().mockReturnValue({
      select: () => ({
        single: () => Promise.resolve({ data: { id: "assess-1" }, error: null }),
      }),
    });
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, plant: PLANT, prev: null, insertSpy }),
    );

    const res = await app.request(req(body()));
    expect(res.status).toBe(200);
    const resBody = (await res.json()) as { id?: string };
    expect(resBody.id).toBe("assess-1");

    // The image travels the network exactly once: request body → Gemini call.
    expect(assessPhotoWithGeminiMock).toHaveBeenCalledOnce();
    const geminiArgs = assessPhotoWithGeminiMock.mock.calls[0][0] as {
      imageBase64: string;
      imageMediaType: string;
    };
    expect(geminiArgs.imageBase64).toBe(SMALL_IMAGE_BASE64);
    expect(geminiArgs.imageMediaType).toBe("image/jpeg");

    // Photos live only on the phone — nothing is stored server-side.
    expect(insertSpy).toHaveBeenCalledOnce();
    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.photo_path).toBeNull();
  });

  it("passes previous assessment into the prompt and links compared_to on insert", async () => {
    assessPhotoWithGeminiMock.mockResolvedValue(
      geminiOk({
        ...DIAGNOSIS_OK,
        health_score: 78,
        summary: "Better — fewer chlorotic leaves.",
        comparison: { delta: "better", notes: "Less yellowing on lower leaves." },
      }),
    );
    const insertSpy = vi.fn().mockReturnValue({
      select: () => ({
        single: () => Promise.resolve({ data: { id: "assess-new" }, error: null }),
      }),
    });
    createClientMock.mockResolvedValue(
      buildSupabaseStub({
        user: { id: "u1" },
        plant: { ...PLANT, cultivar: "Meyer Lemon" },
        prev: {
          id: "assess-prev",
          health_score: 60,
          diagnosis: {
            summary: "Old leaves yellowing.",
            health_score: 60,
            symptoms: [],
            causes: [],
            recommendations: [],
          },
          created_at: "2026-01-01T00:00:00Z",
        },
        insertSpy,
      }),
    );

    const res = await app.request(req(body()));
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledOnce();
    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.compared_to_assessment_id).toBe("assess-prev");
    const promptText = assessPhotoWithGeminiMock.mock.calls[0][0].userText as string;
    expect(promptText).toContain("Previous assessment");
    expect(promptText).toContain("60");
  });

  it("returns a generic 502 when Gemini call fails (no internal details leaked)", async () => {
    assessPhotoWithGeminiMock.mockRejectedValue(
      new Error("Internal: API key abc123 invalid; quota exhausted at https://gen-lang/v1beta"),
    );
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, plant: PLANT }),
    );
    const res = await app.request(req(body()));
    expect(res.status).toBe(502);
    const resBody = (await res.json()) as { error?: string };
    expect(resBody.error).not.toContain("API key");
    expect(resBody.error).not.toContain("abc123");
    expect(resBody.error).not.toContain("gen-lang");
  });

  it("returns a generic 500 when insert fails (no Supabase error message leaked)", async () => {
    assessPhotoWithGeminiMock.mockResolvedValue(geminiOk(DIAGNOSIS_OK));
    createClientMock.mockResolvedValue(
      buildSupabaseStub({
        user: { id: "u1" },
        plant: PLANT,
        insertedId: undefined,
        insertError: { message: "duplicate key value violates unique constraint pk_assessments — table: public.assessments" },
      }),
    );
    const res = await app.request(req(body()));
    expect(res.status).toBe(500);
    const resBody = (await res.json()) as { error?: string };
    expect(resBody.error).not.toContain("duplicate key");
    expect(resBody.error).not.toContain("public.assessments");
  });

  it("returns 429 with Retry-After when rate limit is exceeded (does NOT call Gemini)", async () => {
    createClientMock.mockResolvedValue(
      buildSupabaseStub({
        user: { id: "u1" },
        plant: PLANT,
        rateLimit: { count: 6, allowed: false, retry_after_sec: 1234 },
      }),
    );
    const res = await app.request(req(body()));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1234");
    const resBody = (await res.json()) as { retryAfter?: number };
    expect(resBody.retryAfter).toBe(1234);
    expect(assessPhotoWithGeminiMock).not.toHaveBeenCalled();
  });

  it("returns 502 when Gemini returns invalid JSON", async () => {
    assessPhotoWithGeminiMock.mockRejectedValue(new Error("invalid JSON"));
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, plant: PLANT, insertedId: "a" }),
    );
    const res = await app.request(req(body()));
    expect(res.status).toBe(502);
  });
});

// F21: the phone no longer tells the server what the photo is — the model
// says, and the server derives everything downstream from diagnosis.subject.
describe("POST /assess subject auto-detection (F21)", () => {
  function insertSpy(id = "assess-1") {
    return vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id }, error: null }) }),
    });
  }

  it("derives is_cut_care from subject === 'cut', with no client flag involved", async () => {
    assessPhotoWithGeminiMock.mockResolvedValue(
      geminiOk({ ...DIAGNOSIS_OK, subject: "cut", subject_note: "Sawn branch end." }),
    );
    const insert = insertSpy();
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, plant: PLANT, insertSpy: insert }),
    );

    const res = await app.request(req(body()));
    expect(res.status).toBe(200);
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.is_cut_care).toBe(true);
    expect(row.cut_health_score).toBe(DIAGNOSIS_OK.health_score);
  });

  it("writes is_cut_care false for a whole-plant shot even if the phone sent isCutCare: true", async () => {
    // An un-reloaded phone still posts the old flag; it must not win over the
    // model's own reading of the photo.
    assessPhotoWithGeminiMock.mockResolvedValue(geminiOk({ ...DIAGNOSIS_OK, subject: "whole_plant" }));
    const insert = insertSpy();
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, plant: PLANT, insertSpy: insert }),
    );

    const res = await app.request(req(body({ isCutCare: true })));
    expect(res.status).toBe(200);
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.is_cut_care).toBe(false);
    expect(row.cut_health_score).toBeNull();
  });

  it("accepts (and ignores) a legacy isCutCare body — an un-reloaded phone keeps working", async () => {
    assessPhotoWithGeminiMock.mockResolvedValue(geminiOk({ ...DIAGNOSIS_OK, subject: "leaf" }));
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, plant: PLANT, insertedId: "assess-1" }),
    );
    const res = await app.request(req(body({ isCutCare: false })));
    expect(res.status).toBe(200);
  });

  it("rejects a non-plant photo WITHOUT inserting, returning the diagnosis for the client", async () => {
    const rejected = {
      ...DIAGNOSIS_OK,
      subject: "not_a_plant",
      subject_note: "This is a coffee mug on a desk.",
    };
    assessPhotoWithGeminiMock.mockResolvedValue(geminiOk(rejected));
    const insert = insertSpy();
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, plant: PLANT, insertSpy: insert }),
    );

    const res = await app.request(req(body()));
    expect(res.status).toBe(200);
    const resBody = (await res.json()) as { rejected?: boolean; diagnosis?: { subject?: string }; id?: string };
    expect(resBody.rejected).toBe(true);
    expect(resBody.diagnosis?.subject).toBe("not_a_plant");
    expect(resBody.id).toBeUndefined();
    // The timeline stays clean: nothing was written.
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts a non-plant photo anyway when the client forces it (save-anyway escape hatch)", async () => {
    assessPhotoWithGeminiMock.mockResolvedValue(
      geminiOk({ ...DIAGNOSIS_OK, subject: "not_a_plant" }),
    );
    const insert = insertSpy("assess-forced");
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, plant: PLANT, insertSpy: insert }),
    );

    const res = await app.request(req(body({ force: true })));
    expect(res.status).toBe(200);
    const resBody = (await res.json()) as { id?: string; rejected?: boolean };
    expect(resBody.id).toBe("assess-forced");
    expect(resBody.rejected).toBeUndefined();
    expect(insert).toHaveBeenCalledOnce();
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.is_cut_care).toBe(false);
  });
});

// F22: the phone knows something the server can't — whether the on-device
// model was tried first, and why it was dropped. It travels in the body and
// lands in assessments.engine. It is metadata ONLY: nothing in this route
// branches on it, so a lying client can only mislabel its own row.
describe("POST /assess engine provenance (F22)", () => {
  function insertSpy(id = "assess-1") {
    return vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id }, error: null }) }),
    });
  }

  async function insertedRow(payload: object) {
    assessPhotoWithGeminiMock.mockResolvedValue(geminiOk(DIAGNOSIS_OK));
    const insert = insertSpy();
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, plant: PLANT, insertSpy: insert }),
    );
    const res = await app.request(req(payload));
    expect(res.status).toBe(200);
    return insert.mock.calls[0][0] as Record<string, unknown>;
  }

  it("defaults to gemini when the phone sends no engine (this route IS Gemini)", async () => {
    expect((await insertedRow(body())).engine).toBe("gemini");
  });

  it("persists the escalation reason the phone reports", async () => {
    for (const engine of ["gemini:local_timeout", "gemini:local_invalid", "gemini:local_error"]) {
      expect((await insertedRow(body({ engine }))).engine).toBe(engine);
    }
  });

  it("refuses to record an on-device claim — this route just ran Gemini", async () => {
    expect((await insertedRow(body({ engine: "on-device" }))).engine).toBe("gemini");
  });

  it("falls back to gemini for junk instead of writing it to the column", async () => {
    expect((await insertedRow(body({ engine: "'; drop table assessments--" }))).engine).toBe("gemini");
    expect((await insertedRow(body({ engine: "gemini:whatever" }))).engine).toBe("gemini");
    expect((await insertedRow(body({ engine: 42 }))).engine).toBe("gemini");
    expect((await insertedRow(body({ engine: "x".repeat(500) }))).engine).toBe("gemini");
  });

  it("never 400s on a bad engine — an un-updated phone keeps working", async () => {
    assessPhotoWithGeminiMock.mockResolvedValue(geminiOk(DIAGNOSIS_OK));
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, plant: PLANT, insertedId: "assess-1" }),
    );
    const res = await app.request(req(body({ engine: { nested: "object" } })));
    expect(res.status).toBe(200);
  });
});

describe("removed photo-storage surface (D-16)", () => {
  it("no longer serves /photos or /cleanup-orphans", async () => {
    const photosRes = await app.request(
      new Request("http://localhost/photos?path=u1/t1/x.jpg"),
    );
    expect(photosRes.status).toBe(404);

    const cleanupRes = await app.request(
      new Request("http://localhost/cleanup-orphans", { method: "POST" }),
    );
    expect(cleanupRes.status).toBe(404);
  });
});
