// Pure auth session state machine + Google auth-response helpers.
// No react-native/expo imports here so vitest can run it in Node; the
// side-effectful wiring lives in src/lib/auth.ts and App.tsx.

export const GENERIC_SIGN_IN_ERROR = "Sign-in didn't complete. Please try again.";

export type AuthPhase = "restoring" | "signedOut" | "signingIn" | "signedIn";

export interface AuthState {
  phase: AuthPhase;
  userEmail: string | null;
  error: string | null;
}

export type AuthEvent =
  /** Supabase session established or cleared (initial restore + onAuthStateChange). */
  | { type: "SESSION_CHANGED"; email: string | null }
  | { type: "SIGN_IN_STARTED" }
  | { type: "SIGN_IN_FAILED" }
  | { type: "SIGN_IN_DISMISSED" };

export const initialAuthState: AuthState = {
  phase: "restoring",
  userEmail: null,
  error: null,
};

export function authReducer(state: AuthState, event: AuthEvent): AuthState {
  switch (event.type) {
    case "SESSION_CHANGED":
      // The Supabase auth listener is authoritative in every phase.
      return event.email === null
        ? { phase: "signedOut", userEmail: null, error: state.error }
        : { phase: "signedIn", userEmail: event.email, error: null };
    case "SIGN_IN_STARTED":
      return { ...state, phase: "signingIn", error: null };
    case "SIGN_IN_FAILED":
      return { phase: "signedOut", userEmail: null, error: GENERIC_SIGN_IN_ERROR };
    case "SIGN_IN_DISMISSED":
      return { phase: "signedOut", userEmail: null, error: null };
  }
}

/** Structural subset of expo-auth-session's AuthSessionResult. */
export interface GoogleAuthResult {
  type: string;
  params?: Record<string, string>;
}

export type IdTokenResult =
  | { ok: true; idToken: string }
  | { ok: false; reason: "dismissed" | "error" };

export function extractIdToken(result: GoogleAuthResult | null): IdTokenResult {
  if (!result) return { ok: false, reason: "error" };
  if (result.type === "cancel" || result.type === "dismiss" || result.type === "locked") {
    return { ok: false, reason: "dismissed" };
  }
  if (result.type === "success" && result.params?.id_token) {
    return { ok: true, idToken: result.params.id_token };
  }
  return { ok: false, reason: "error" };
}
