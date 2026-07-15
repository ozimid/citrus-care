import { describe, expect, it, vi, beforeEach } from "vitest";

const getAuthMock = vi.fn();
const getUploadUrlMock = vi.fn();
const getReadUrlMock = vi.fn();
const deletePrefixMock = vi.fn();

vi.mock("../src/auth", () => ({
  getAuth: (...args: unknown[]) => getAuthMock(...args),
}));

vi.mock("../src/storage", () => ({
  getStorage: () => ({
    getUploadUrl: (...a: unknown[]) => getUploadUrlMock(...a),
    getReadUrl: (...a: unknown[]) => getReadUrlMock(...a),
    deletePrefix: (...a: unknown[]) => deletePrefixMock(...a),
  }),
}));

import app from "../src/index";

/** A supabase stub whose plants lookup resolves to `plant`. */
function authWith(userId: string, plant: Record<string, unknown> | null) {
  return {
    user: { id: userId },
    supabase: {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "plants") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: plant, error: null }),
              }),
            }),
          };
        }
        return {};
      }),
    },
  };
}

function signUploadReq(body: object) {
  return new Request("http://localhost/photos/sign-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function readReq(path: string) {
  return new Request(
    `http://localhost/photos?path=${encodeURIComponent(path)}`,
    { method: "GET" },
  );
}

function deleteReq(prefix: string) {
  return new Request(
    `http://localhost/photos?prefix=${encodeURIComponent(prefix)}`,
    { method: "DELETE" },
  );
}

beforeEach(() => {
  getAuthMock.mockReset();
  getUploadUrlMock.mockReset();
  getReadUrlMock.mockReset();
  deletePrefixMock.mockReset();
});

describe("POST /photos/sign-upload", () => {
  it("returns 401 when not authenticated", async () => {
    getAuthMock.mockResolvedValue(null);
    const res = await app.request(
      signUploadReq({ plantId: "t1", mime: "image/jpeg" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 on an unsupported mime type", async () => {
    getAuthMock.mockResolvedValue(authWith("u1", { id: "t1" }));
    const res = await app.request(
      signUploadReq({ plantId: "t1", mime: "image/gif" }),
    );
    expect(res.status).toBe(400);
    expect(getUploadUrlMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the plant is not owned by the user", async () => {
    getAuthMock.mockResolvedValue(authWith("u1", null));
    const res = await app.request(
      signUploadReq({ plantId: "t1", mime: "image/jpeg" }),
    );
    expect(res.status).toBe(404);
  });

  it("constructs the path server-side, ignoring any client-supplied path", async () => {
    getAuthMock.mockResolvedValue(authWith("u1", { id: "t1" }));
    getUploadUrlMock.mockResolvedValue("https://signed.example/put");
    const res = await app.request(
      signUploadReq({
        plantId: "t1",
        mime: "image/jpeg",
        // Attacker-supplied path — must be ignored entirely.
        photoPath: "attacker/t1/evil.jpg",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { photoPath: string; uploadUrl: string };
    expect(body.uploadUrl).toBe("https://signed.example/put");
    expect(body.photoPath).toMatch(/^u1\/t1\/[0-9a-f-]{36}\.jpg$/);
    expect(body.photoPath).not.toContain("attacker");
    // The storage backend was asked to sign the SERVER path, not the client's.
    expect(getUploadUrlMock).toHaveBeenCalledWith(body.photoPath, "image/jpeg");
  });

  it("returns a generic 500 when signing fails (no internal detail leaked)", async () => {
    getAuthMock.mockResolvedValue(authWith("u1", { id: "t1" }));
    getUploadUrlMock.mockRejectedValue(
      new Error("gcs private_key BEGIN ... invalid; project secret-xyz"),
    );
    const res = await app.request(
      signUploadReq({ plantId: "t1", mime: "image/jpeg" }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).not.toContain("private_key");
    expect(body.error).not.toContain("secret-xyz");
  });
});

describe("GET /photos (read proxy)", () => {
  it("returns 401 when not authenticated", async () => {
    getAuthMock.mockResolvedValue(null);
    const res = await app.request(readReq("u1/t1/p.jpg"));
    expect(res.status).toBe(401);
    expect(getReadUrlMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a path that is not owned by the user", async () => {
    getAuthMock.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
    const res = await app.request(readReq("someoneelse/t1/p.jpg"));
    expect(res.status).toBe(403);
    expect(getReadUrlMock).not.toHaveBeenCalled();
  });

  it("302-redirects to the signed read URL for an owned path", async () => {
    getAuthMock.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
    getReadUrlMock.mockResolvedValue("https://signed.example/get?token=abc");
    const res = await app.request(readReq("u1/t1/p.jpg"));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "https://signed.example/get?token=abc",
    );
    expect(getReadUrlMock).toHaveBeenCalledWith("u1/t1/p.jpg", 3600);
  });
});

describe("DELETE /photos", () => {
  it("returns 401 when not authenticated", async () => {
    getAuthMock.mockResolvedValue(null);
    const res = await app.request(deleteReq("u1/t1/"));
    expect(res.status).toBe(401);
    expect(deletePrefixMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a prefix that is not owned by the user", async () => {
    getAuthMock.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
    const res = await app.request(deleteReq("someoneelse/t1/"));
    expect(res.status).toBe(403);
    expect(deletePrefixMock).not.toHaveBeenCalled();
  });

  it("deletes an owned prefix and returns ok", async () => {
    getAuthMock.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
    deletePrefixMock.mockResolvedValue(undefined);
    const res = await app.request(deleteReq("u1/t1/"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
    expect(deletePrefixMock).toHaveBeenCalledWith("u1/t1/");
  });
});
