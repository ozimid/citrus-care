import { describe, expect, it } from "vitest";
import {
  GENERIC_SIGN_IN_ERROR,
  authReducer,
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

// --- native Google Sign-In result mapping (v13+ shapes) ---
import { idTokenFromNativeSignIn } from "./auth-state";

describe("idTokenFromNativeSignIn", () => {
  it("extracts the idToken from a successful native sign-in", () => {
    const r = idTokenFromNativeSignIn({ type: "success", data: { idToken: "tok-123" } });
    expect(r).toEqual({ ok: true, idToken: "tok-123" });
  });

  it("treats a cancelled sign-in as dismissed", () => {
    const r = idTokenFromNativeSignIn({ type: "cancelled", data: null });
    expect(r).toEqual({ ok: false, reason: "dismissed" });
  });

  it("fails when success carries no idToken", () => {
    const r = idTokenFromNativeSignIn({ type: "success", data: { idToken: null } });
    expect(r).toEqual({ ok: false, reason: "error" });
  });

  it("fails on null/undefined results", () => {
    expect(idTokenFromNativeSignIn(null)).toEqual({ ok: false, reason: "error" });
  });
});
