import { describe, expect, it, vi, beforeEach } from "vitest";

const createClientMock = vi.fn();
const listAllMock = vi.fn();
const deletePrefixMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => createClientMock(),
}));

// Storage I/O flows through the abstraction; the DB (active paths) still comes
// from a service-role Supabase client created inside the route.
vi.mock("../src/storage", () => ({
  getStorage: () => ({
    listAll: (...args: unknown[]) => listAllMock(...args),
    deletePrefix: (...args: unknown[]) => deletePrefixMock(...args),
  }),
}));

import app from "../src/index";

function buildDbStub(assessments: { photo_path: string }[]) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "assessments") {
        return {
          select: () => Promise.resolve({ data: assessments, error: null }),
        };
      }
      return {};
    }),
  };
}

function req(headers: Record<string, string>) {
  return new Request("http://localhost/cleanup-orphans", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  createClientMock.mockReset();
  listAllMock.mockReset();
  deletePrefixMock.mockReset();
  deletePrefixMock.mockResolvedValue(undefined);
  process.env.CLEANUP_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://fake-db";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
});

describe("POST /cleanup-orphans", () => {
  it("returns 401 when Authorization header is invalid", async () => {
    const res = await app.request(req({ Authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("deletes only old orphans; keeps active, young, and timestamp-less objects", async () => {
    const now = Date.now();
    const oneDayAgo = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(now - 1 * 60 * 60 * 1000).toISOString();

    createClientMock.mockReturnValue(
      buildDbStub([{ photo_path: "user1/plant1/keep-active.jpg" }]),
    );

    listAllMock.mockResolvedValue([
      { name: "user1/plant1/keep-active.jpg", createdAt: oneDayAgo }, // active → keep
      { name: "user1/plant1/delete-old-orphan.jpg", createdAt: oneDayAgo }, // old orphan → delete
      { name: "user1/plant1/keep-young-orphan.jpg", createdAt: oneHourAgo }, // young → keep
      { name: "user1/plant1/no-timestamp.jpg", createdAt: null }, // unknown age → never delete
    ]);

    const res = await app.request(req({ Authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { deleted?: number };
    expect(body.deleted).toBe(1);
    expect(deletePrefixMock).toHaveBeenCalledTimes(1);
    expect(deletePrefixMock).toHaveBeenCalledWith(
      "user1/plant1/delete-old-orphan.jpg",
    );
  });

  it("returns a generic 500 if storage listing throws (no leak)", async () => {
    createClientMock.mockReturnValue(buildDbStub([]));
    listAllMock.mockRejectedValue(
      new Error("gcs credentials invalid: secret-token-xyz"),
    );

    const res = await app.request(req({ Authorization: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).not.toContain("secret-token-xyz");
  });
});
