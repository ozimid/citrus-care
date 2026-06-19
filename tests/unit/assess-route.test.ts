import { describe, expect, it, vi, beforeEach } from "vitest";

const createClientMock = vi.fn();
const assessPhotoWithGeminiMock = vi.fn();

vi.mock("@/app/_lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));

vi.mock("@/app/_lib/gemini", async () => {
  const real = await vi.importActual<typeof import("@/app/_lib/gemini")>(
    "@/app/_lib/gemini",
  );
  return {
    ...real,
    assessPhotoWithGemini: (...args: unknown[]) => assessPhotoWithGeminiMock(...args),
  };
});

import { POST } from "@/app/api/assess/route";

function buildSupabaseStub(opts: {
  user?: { id: string } | null;
  plant?: Record<string, unknown> | null;
  prev?: Record<string, unknown> | null;
  download?: Blob | null;
  insertedId?: string;
  insertError?: { message: string } | null;
  rateLimit?: { count: number; allowed: boolean; retry_after_sec: number };
}) {
  const user = "user" in opts ? opts.user : { id: "user-1" };
  const rl = opts.rateLimit ?? { count: 1, allowed: true, retry_after_sec: 0 };
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
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: opts.insertedId ? { id: opts.insertedId } : null,
                  error: opts.insertError ?? null,
                }),
            }),
          }),
        };
      }
      return {};
    }),
    storage: {
      from: () => ({
        download: vi
          .fn()
          .mockResolvedValue({ data: opts.download ?? new Blob(["hi"]), error: null }),
      }),
    },
  };
}

function req(body: object) {
  return new Request("http://localhost/api/assess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function geminiOk(payload: Record<string, unknown>) {
  const raw = JSON.stringify(payload);
  return { diagnosis: payload, raw };
}

beforeEach(() => {
  createClientMock.mockReset();
  assessPhotoWithGeminiMock.mockReset();
});

describe("POST /api/assess", () => {
  it("returns 401 when not authenticated", async () => {
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: null, plant: { id: "t1", user_id: "u1" } }),
    );
    const res = await POST(req({ plantId: "t1", photoPath: "u1/t1/x.jpg" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid input", async () => {
    createClientMock.mockResolvedValue(buildSupabaseStub({}));
    const res = await POST(req({ plantId: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the plant is not found", async () => {
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, plant: null }),
    );
    const res = await POST(req({ plantId: "t1", photoPath: "u1/t1/x.jpg" }));
    expect(res.status).toBe(404);
  });

  it("calls Gemini with the prompt, persists, returns the new assessment id", async () => {
    assessPhotoWithGeminiMock.mockResolvedValue(
      geminiOk({
        health_score: 80,
        summary: "Looks healthy.",
        symptoms: [],
        causes: [],
        recommendations: [
          { priority: 1, action: "Water deeply weekly", detail: "Until drains." },
        ],
      }),
    );
    createClientMock.mockResolvedValue(
      buildSupabaseStub({
        user: { id: "u1" },
        plant: { id: "t1", user_id: "u1", name: "Mr Lemon", plant_type: "tree", species: null, cultivar: null, location: null, zip_code: null },
        prev: null,
        download: new Blob(["fake"], { type: "image/jpeg" }),
        insertedId: "assess-1",
      }),
    );
    const res = await POST(req({ plantId: "t1", photoPath: "u1/t1/x.jpg" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("assess-1");
    expect(assessPhotoWithGeminiMock).toHaveBeenCalledOnce();
  });

  it("passes previous assessment into the prompt and links compared_to on insert", async () => {
    assessPhotoWithGeminiMock.mockResolvedValue(
      geminiOk({
        health_score: 78,
        summary: "Better — fewer chlorotic leaves.",
        symptoms: [],
        causes: [],
        recommendations: [],
        comparison: { delta: "better", notes: "Less yellowing on lower leaves." },
      }),
    );

    const insertSpy = vi.fn().mockReturnValue({
      select: () => ({
        single: () => Promise.resolve({ data: { id: "assess-new" }, error: null }),
      }),
    });

    createClientMock.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: [{ count: 1, allowed: true, retry_after_sec: 0 }],
        error: null,
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "u1" } },
          error: null,
        }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "plants") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      id: "t1",
                      user_id: "u1",
                      name: "Mr Lemon",
                      plant_type: "tree",
                      species: null,
                      cultivar: "Meyer Lemon",
                      location: null,
                      zip_code: null,
                    },
                    error: null,
                  }),
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
                      Promise.resolve({
                        data: {
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
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
            insert: insertSpy,
          };
        }
        return {};
      }),
      storage: {
        from: () => ({
          download: vi
            .fn()
            .mockResolvedValue({
              data: new Blob(["fake"], { type: "image/jpeg" }),
              error: null,
            }),
        }),
      },
    });

    const res = await POST(req({ plantId: "t1", photoPath: "u1/t1/x.jpg" }));
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledOnce();
    const row = insertSpy.mock.calls[0][0];
    expect(row.compared_to_assessment_id).toBe("assess-prev");
    const promptText = assessPhotoWithGeminiMock.mock.calls[0][0].userText as string;
    expect(promptText).toContain("Previous assessment");
    expect(promptText).toContain("60");
  });

  it("returns 403 when photoPath does not belong to the authenticated user", async () => {
    createClientMock.mockResolvedValue(
      buildSupabaseStub({
        user: { id: "u1" },
        plant: { id: "t1", user_id: "u1", name: "x", plant_type: "tree", species: null, cultivar: null, location: null, zip_code: null },
      }),
    );
    const res = await POST(req({ plantId: "t1", photoPath: "OTHER-USER/t1/x.jpg" }));
    expect(res.status).toBe(403);
    expect(assessPhotoWithGeminiMock).not.toHaveBeenCalled();
  });

  it("returns a generic 502 when Gemini call fails (no internal details leaked)", async () => {
    assessPhotoWithGeminiMock.mockRejectedValue(
      new Error("Internal: API key abc123 invalid; quota exhausted at https://gen-lang/v1beta"),
    );
    createClientMock.mockResolvedValue(
      buildSupabaseStub({
        user: { id: "u1" },
        plant: { id: "t1", user_id: "u1", name: "x", plant_type: "tree", species: null, cultivar: null, location: null, zip_code: null },
      }),
    );
    const res = await POST(req({ plantId: "t1", photoPath: "u1/t1/x.jpg" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).not.toContain("API key");
    expect(body.error).not.toContain("abc123");
    expect(body.error).not.toContain("gen-lang");
  });

  it("returns a generic 500 when insert fails (no Supabase error message leaked)", async () => {
    assessPhotoWithGeminiMock.mockResolvedValue(
      geminiOk({
        health_score: 80,
        summary: "ok.",
        symptoms: [],
        causes: [],
        recommendations: [],
      }),
    );
    createClientMock.mockResolvedValue(
      buildSupabaseStub({
        user: { id: "u1" },
        plant: { id: "t1", user_id: "u1", name: "x", plant_type: "tree", species: null, cultivar: null, location: null, zip_code: null },
        insertedId: undefined,
        insertError: { message: "duplicate key value violates unique constraint pk_assessments — table: public.assessments" },
      }),
    );
    const res = await POST(req({ plantId: "t1", photoPath: "u1/t1/x.jpg" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain("duplicate key");
    expect(body.error).not.toContain("public.assessments");
  });

  it("returns 429 with Retry-After when rate limit is exceeded (does NOT call Gemini)", async () => {
    createClientMock.mockResolvedValue(
      buildSupabaseStub({
        user: { id: "u1" },
        plant: { id: "t1", user_id: "u1", name: "x", plant_type: "tree", species: null, cultivar: null, location: null, zip_code: null },
        rateLimit: { count: 6, allowed: false, retry_after_sec: 1234 },
      }),
    );
    const res = await POST(req({ plantId: "t1", photoPath: "u1/t1/x.jpg" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1234");
    const body = await res.json();
    expect(body.retryAfter).toBe(1234);
    expect(assessPhotoWithGeminiMock).not.toHaveBeenCalled();
  });

  it("returns 502 when Gemini returns invalid JSON", async () => {
    assessPhotoWithGeminiMock.mockRejectedValue(new Error("invalid JSON"));
    createClientMock.mockResolvedValue(
      buildSupabaseStub({
        user: { id: "u1" },
        plant: { id: "t1", user_id: "u1", name: "x", plant_type: "tree", species: null, cultivar: null, location: null, zip_code: null },
        insertedId: "a",
      }),
    );
    const res = await POST(req({ plantId: "t1", photoPath: "u1/t1/x.jpg" }));
    expect(res.status).toBe(502);
  });
});
