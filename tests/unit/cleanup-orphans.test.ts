import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

const createClientMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => createClientMock(),
}));

import { POST } from "@/app/api/cleanup-orphans/route";

interface StorageFileStub {
  name: string;
  id: string | null;
  created_at?: string;
}

function buildSupabaseStub(opts: {
  assessments?: { photo_path: string }[];
  storageFiles?: Record<string, StorageFileStub[]>;
  removeSpy?: Mock;
}) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "assessments") {
        return {
          select: () => Promise.resolve({ data: opts.assessments ?? [], error: null }),
        };
      }
      return {};
    }),
    storage: {
      from: vi.fn().mockImplementation((bucket: string) => {
        if (bucket === "photos") {
          return {
            list: vi.fn().mockImplementation((prefix: string) => {
              const files = opts.storageFiles?.[prefix || ""] ?? [];
              return Promise.resolve({ data: files, error: null });
            }),
            remove: opts.removeSpy ?? vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      }),
    },
  };
}

function req(headers: Record<string, string>) {
  return new Request("http://localhost/api/cleanup-orphans", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  createClientMock.mockReset();
  process.env.CLEANUP_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://fake-db";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
});

describe("POST /api/cleanup-orphans", () => {
  it("returns 401 when Authorization header is invalid", async () => {
    const res = await POST(req({ Authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("lists, checks age/active status, and removes orphans successfully", async () => {
    const removeSpy = vi.fn().mockResolvedValue({ error: null });
    const now = new Date();
    
    const oneDayAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);

    const client = buildSupabaseStub({
      assessments: [{ photo_path: "user1/plant1/keep-active.jpg" }],
      storageFiles: {
        "": [{ name: "user1", id: null }],
        "user1": [{ name: "plant1", id: null }],
        "user1/plant1": [
          { name: "keep-active.jpg", id: "f1", created_at: oneDayAgo.toISOString() }, // active, do not delete
          { name: "delete-old-orphan.jpg", id: "f2", created_at: oneDayAgo.toISOString() }, // old orphan, delete
          { name: "keep-young-orphan.jpg", id: "f3", created_at: oneHourAgo.toISOString() }, // young orphan, do not delete
        ],
      },
      removeSpy,
    });
    createClientMock.mockReturnValue(client);

    const res = await POST(req({ Authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    
    const body = await res.json();
    expect(body.deleted).toBe(1);
    expect(removeSpy).toHaveBeenCalledWith(["user1/plant1/delete-old-orphan.jpg"]);
  });
});
