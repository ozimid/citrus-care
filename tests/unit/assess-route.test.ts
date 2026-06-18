import { describe, expect, it, vi, beforeEach } from "vitest";

const createClientMock = vi.fn();
const callGeminiVisionMock = vi.fn();

vi.mock("@/app/_lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));

vi.mock("@/app/_lib/gemini", async () => {
  const real = await vi.importActual<typeof import("@/app/_lib/gemini")>(
    "@/app/_lib/gemini",
  );
  return {
    ...real,
    callGeminiVision: (...args: unknown[]) => callGeminiVisionMock(...args),
  };
});

import { POST } from "@/app/api/assess/route";

function buildSupabaseStub(opts: {
  user?: { id: string } | null;
  tree?: Record<string, unknown> | null;
  prev?: Record<string, unknown> | null;
  download?: Blob | null;
  insertedId?: string;
  insertError?: { message: string } | null;
}) {
  const user = "user" in opts ? opts.user : { id: "user-1" };
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "trees") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: opts.tree, error: null }),
            }),
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

beforeEach(() => {
  createClientMock.mockReset();
  callGeminiVisionMock.mockReset();
});

describe("POST /api/assess", () => {
  it("returns 401 when not authenticated", async () => {
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: null, tree: { id: "t1", user_id: "u1" } }),
    );
    const res = await POST(req({ treeId: "t1", photoPath: "u1/t1/x.jpg" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid input", async () => {
    createClientMock.mockResolvedValue(buildSupabaseStub({}));
    const res = await POST(req({ treeId: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the tree is not found", async () => {
    createClientMock.mockResolvedValue(
      buildSupabaseStub({ user: { id: "u1" }, tree: null }),
    );
    const res = await POST(req({ treeId: "t1", photoPath: "u1/t1/x.jpg" }));
    expect(res.status).toBe(404);
  });

  it("calls Gemini with the prompt, persists, returns the new assessment id", async () => {
    callGeminiVisionMock.mockResolvedValue(
      JSON.stringify({
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
        tree: { id: "t1", user_id: "u1", name: "Mr Lemon", cultivar: null, location: null },
        prev: null,
        download: new Blob(["fake"], { type: "image/jpeg" }),
        insertedId: "assess-1",
      }),
    );
    const res = await POST(req({ treeId: "t1", photoPath: "u1/t1/x.jpg" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("assess-1");
    expect(callGeminiVisionMock).toHaveBeenCalledOnce();
  });

  it("passes previous assessment into the prompt and links compared_to on insert", async () => {
    callGeminiVisionMock.mockResolvedValue(
      JSON.stringify({
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
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "u1" } },
          error: null,
        }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "trees") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      id: "t1",
                      user_id: "u1",
                      name: "Mr Lemon",
                      cultivar: "Meyer Lemon",
                      location: null,
                    },
                    error: null,
                  }),
              }),
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

    const res = await POST(req({ treeId: "t1", photoPath: "u1/t1/x.jpg" }));
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledOnce();
    const row = insertSpy.mock.calls[0][0];
    expect(row.compared_to_assessment_id).toBe("assess-prev");
    const promptText = callGeminiVisionMock.mock.calls[0][0].userText as string;
    expect(promptText).toContain("Previous assessment");
    expect(promptText).toContain("60");
  });

  it("returns 502 when Gemini returns invalid JSON", async () => {
    callGeminiVisionMock.mockResolvedValue("not json at all");
    createClientMock.mockResolvedValue(
      buildSupabaseStub({
        user: { id: "u1" },
        tree: { id: "t1", user_id: "u1", name: "x", cultivar: null, location: null },
        insertedId: "a",
      }),
    );
    const res = await POST(req({ treeId: "t1", photoPath: "u1/t1/x.jpg" }));
    expect(res.status).toBe(502);
  });
});
