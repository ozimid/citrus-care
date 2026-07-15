// Talking to the standalone Hono API service (apps/api) — pure, tested logic:
// origin resolution (EXPO_PUBLIC_API_ORIGIN / extra.apiOrigin / LAN default)
// and a Bearer-authenticated fetch built from injected deps. The real wiring
// (expo-constants + the Supabase session) lives in api-io.ts, same pure/thin
// split as photo.ts vs photo-io.ts.

/** LAN dev default: the phone must reach `npm run dev`'s api service (port
 * 3003) on the developer machine's LAN address — localhost on-device is the
 * phone itself. Override via EXPO_PUBLIC_API_ORIGIN (see README). */
// Default routes through the web dev server's /api rewrites on port 3002 —
// the one port this phone has provably reached for weeks (PWA dogfooding).
// Direct api access (http://<lan-ip>:3003) remains a valid override.
export const DEFAULT_API_ORIGIN = "http://192.168.1.205:3002/api";

type Extra = Record<string, unknown> | undefined | null;
type Env = Record<string, string | undefined>;

function usable(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.startsWith("YOUR_");
}

export function resolveApiOrigin(extra: Extra, env: Env): string {
  const fromEnv = env.EXPO_PUBLIC_API_ORIGIN;
  const origin = usable(fromEnv) ? fromEnv : usable(extra?.apiOrigin) ? extra.apiOrigin : DEFAULT_API_ORIGIN;
  return origin.replace(/\/+$/, "");
}

/** Minimal structural response type so tests (and RN's fetch) both satisfy it. */
export interface ApiResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface ApiRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/** HTTP failure from the API service. `friendlyAssessError` (assess.ts) maps
 * these to the user-facing strings; raw server messages never reach the UI. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message?: string,
    public retryAfter?: number,
  ) {
    super(message ?? `API request failed (${status})`);
  }
}

/** Build an ApiError from a non-ok response, tolerating non-JSON bodies. */
export async function apiErrorFrom(res: ApiResponse): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; retryAfter?: number };
  return new ApiError(res.status, body.error, body.retryAfter);
}

export type AuthorizedFetch = (path: string, init?: ApiRequestInit) => Promise<ApiResponse>;

export interface AuthorizedFetchDeps {
  origin: string;
  /** Current Supabase access token, or null when signed out/expired. */
  getAccessToken: () => Promise<string | null>;
  fetchFn: (url: string, init?: ApiRequestInit) => Promise<ApiResponse>;
}

/** Fetch wrapper that attaches `Authorization: Bearer <access_token>` — the
 * mobile half of apps/api's Bearer-or-cookie auth. No session → ApiError 401,
 * which maps to the same "sign in again" string as a server 401. */
export function createAuthorizedFetch(deps: AuthorizedFetchDeps): AuthorizedFetch {
  return async (path, init) => {
    const token = await deps.getAccessToken();
    if (!token) throw new ApiError(401);
    return deps.fetchFn(`${deps.origin}${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
  };
}
