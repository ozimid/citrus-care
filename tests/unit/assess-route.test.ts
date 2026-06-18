import { describe, expect, it, vi, beforeEach } from "vitest";

const createClientMock = vi.fn();
const callClaudeVisionMock = vi.fn();

vi.mock("@/app/_lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));

vi.mock("@/app/_lib/claude", async () => {
  const real = await vi.importActual<typeof import("@/app/_lib/claude")>(
    "@/app/_lib/claude",
  );
  return {
    ...real,
    callClaudeVision: (...args: unknown[]) => callClaudeVisionMock(...args),
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
  callClaudeVisionMock.mockReset();
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

  it("calls Claude with the prompt, persists, returns the new assessment id", async () => {
    callClaudeVisionMock.mockResolvedValue(
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
    expect(callClaudeVisionMock).toHaveBeenCalledOnce();
  });

  it("returns 502 when Claude returns invalid JSON", async () => {
    callClaudeVisionMock.mockResolvedValue("not json at all");
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
