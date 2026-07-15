import { describe, expect, it } from "vitest";
import {
  ApiError,
  DEFAULT_API_ORIGIN,
  apiErrorFrom,
  createAuthorizedFetch,
  resolveApiOrigin,
  type ApiResponse,
} from "./api";

function response(overrides: Partial<ApiResponse> = {}): ApiResponse {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    ...overrides,
  };
}

describe("resolveApiOrigin", () => {
  it("defaults to the LAN dev origin when nothing is configured", () => {
    expect(resolveApiOrigin(undefined, {})).toBe("http://192.168.1.205:3002/api");
    expect(DEFAULT_API_ORIGIN).toBe("http://192.168.1.205:3002/api");
  });

  it("prefers the EXPO_PUBLIC_API_ORIGIN env var over extra", () => {
    expect(
      resolveApiOrigin(
        { apiOrigin: "https://extra.example.com" },
        { EXPO_PUBLIC_API_ORIGIN: "https://env.example.com" },
      ),
    ).toBe("https://env.example.com");
  });

  it("falls back to app.json extra.apiOrigin", () => {
    expect(resolveApiOrigin({ apiOrigin: "https://extra.example.com" }, {})).toBe(
      "https://extra.example.com",
    );
  });

  it("ignores YOUR_ placeholders and empty strings", () => {
    expect(
      resolveApiOrigin({ apiOrigin: "YOUR_API_ORIGIN" }, { EXPO_PUBLIC_API_ORIGIN: "" }),
    ).toBe(DEFAULT_API_ORIGIN);
  });

  it("strips trailing slashes so path joins stay clean", () => {
    expect(resolveApiOrigin(undefined, { EXPO_PUBLIC_API_ORIGIN: "https://api.example.com/" })).toBe(
      "https://api.example.com",
    );
  });
});

describe("createAuthorizedFetch", () => {
  it("attaches the Supabase access token as a Bearer header", async () => {
    const calls: Array<{ url: string; init?: { headers?: Record<string, string> } }> = [];
    const api = createAuthorizedFetch({
      origin: "https://api.example.com",
      getAccessToken: async () => "token-123",
      fetchFn: async (url, init) => {
        calls.push({ url, init });
        return response();
      },
    });

    await api("/assess", { method: "POST", headers: { "Content-Type": "application/json" } });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example.com/assess");
    expect(calls[0].init?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer token-123",
    });
  });

  it("throws a 401 ApiError when there is no session", async () => {
    const api = createAuthorizedFetch({
      origin: "https://api.example.com",
      getAccessToken: async () => null,
      fetchFn: async () => {
        throw new Error("must not be called");
      },
    });

    await expect(api("/assess")).rejects.toMatchObject({ status: 401 });
    await expect(api("/assess")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("apiErrorFrom", () => {
  it("carries status, server error string, and retryAfter", async () => {
    const err = await apiErrorFrom(
      response({
        ok: false,
        status: 429,
        json: async () => ({ error: "Too many assessments. Please try again later.", retryAfter: 1800 }),
      }),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(1800);
  });

  it("survives non-JSON error bodies", async () => {
    const err = await apiErrorFrom(
      response({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("not json");
        },
      }),
    );
    expect(err.status).toBe(500);
    expect(err.retryAfter).toBeUndefined();
  });
});
