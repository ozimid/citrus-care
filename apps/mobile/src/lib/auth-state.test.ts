import { describe, expect, it } from "vitest";
import {
  GENERIC_SIGN_IN_ERROR,
  authReducer,
  extractIdToken,
  initialAuthState,
  type AuthState,
} from "./auth-state";

describe("authReducer", () => {
  it("starts in a restoring phase with no user and no error", () => {
    expect(initialAuthState).toEqual({ phase: "restoring", userEmail: null, error: null });
  });

  it("moves restoring -> signedIn when a stored session is found", () => {
    const next = authReducer(initialAuthState, {
      type: "SESSION_CHANGED",
      email: "grower@example.com",
    });
    expect(next.phase).toBe("signedIn");
    expect(next.userEmail).toBe("grower@example.com");
    expect(next.error).toBeNull();
  });

  it("moves restoring -> signedOut when no stored session exists", () => {
    const next = authReducer(initialAuthState, { type: "SESSION_CHANGED", email: null });
    expect(next.phase).toBe("signedOut");
    expect(next.userEmail).toBeNull();
  });

  it("clears any prior error when a sign-in attempt starts", () => {
    const errored: AuthState = { phase: "signedOut", userEmail: null, error: GENERIC_SIGN_IN_ERROR };
    const next = authReducer(errored, { type: "SIGN_IN_STARTED" });
    expect(next.phase).toBe("signingIn");
    expect(next.error).toBeNull();
  });

  it("returns to signedOut with the generic error on failure — never a provider message", () => {
    const signingIn: AuthState = { phase: "signingIn", userEmail: null, error: null };
    const next = authReducer(signingIn, { type: "SIGN_IN_FAILED" });
    expect(next.phase).toBe("signedOut");
    expect(next.error).toBe(GENERIC_SIGN_IN_ERROR);
  });

  it("returns to signedOut silently when the user dismisses the Google sheet", () => {
    const signingIn: AuthState = { phase: "signingIn", userEmail: null, error: null };
    const next = authReducer(signingIn, { type: "SIGN_IN_DISMISSED" });
    expect(next.phase).toBe("signedOut");
    expect(next.error).toBeNull();
  });

  it("treats the Supabase auth listener as authoritative in any phase", () => {
    const signingIn: AuthState = { phase: "signingIn", userEmail: null, error: null };
    const next = authReducer(signingIn, { type: "SESSION_CHANGED", email: "grower@example.com" });
    expect(next.phase).toBe("signedIn");
  });

  it("moves signedIn -> signedOut when the session ends", () => {
    const signedIn: AuthState = { phase: "signedIn", userEmail: "grower@example.com", error: null };
    const next = authReducer(signedIn, { type: "SESSION_CHANGED", email: null });
    expect(next.phase).toBe("signedOut");
    expect(next.userEmail).toBeNull();
  });
});

describe("extractIdToken", () => {
  it("returns the id token on a successful auth response", () => {
    const result = extractIdToken({ type: "success", params: { id_token: "jwt-abc" } });
    expect(result).toEqual({ ok: true, idToken: "jwt-abc" });
  });

  it("reports a dismissal (cancel/dismiss) as dismissed, not an error", () => {
    expect(extractIdToken({ type: "cancel" })).toEqual({ ok: false, reason: "dismissed" });
    expect(extractIdToken({ type: "dismiss" })).toEqual({ ok: false, reason: "dismissed" });
  });

  it("treats a success response without an id_token as an error", () => {
    expect(extractIdToken({ type: "success", params: {} })).toEqual({ ok: false, reason: "error" });
  });

  it("treats provider errors as errors", () => {
    expect(extractIdToken({ type: "error" })).toEqual({ ok: false, reason: "error" });
  });

  it("treats a null response (prompt never resolved) as an error", () => {
    expect(extractIdToken(null)).toEqual({ ok: false, reason: "error" });
  });
});
