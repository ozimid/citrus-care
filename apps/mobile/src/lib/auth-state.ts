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

export type IdTokenResult =
  | { ok: true; idToken: string }
  | { ok: false; reason: "dismissed" | "error" };

// --- native Google Sign-In (@react-native-google-signin) result mapping ---

/** Shape of GoogleSignin.signIn() results we rely on (v13+). */
export interface NativeSignInResult {
  type: "success" | "cancelled" | string;
  data: { idToken?: string | null } | null;
}

export function idTokenFromNativeSignIn(
  result: NativeSignInResult | null | undefined,
): IdTokenResult {
  if (!result) return { ok: false, reason: "error" };
  if (result.type === "cancelled") return { ok: false, reason: "dismissed" };
  const idToken = result.type === "success" ? result.data?.idToken : null;
  if (!idToken) return { ok: false, reason: "error" };
  return { ok: true, idToken };
}
