// Google sign-in via the native Google Sign-In SDK
// (@react-native-google-signin) -> idToken -> supabase.auth.signInWithIdToken.
// This replaced expo-auth-session's browser-redirect flow, which Google now
// rejects for Android client types ("Error 400: invalid_request") — the
// native SDK authenticates via package name + signing SHA-1 instead of
// redirect URIs. Success is observed via Supabase's onAuthStateChange
// listener (wired in App.tsx), not here.

import {
  GoogleSignin,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import { useCallback, useMemo } from "react";
import { idTokenFromNativeSignIn, type AuthEvent } from "./auth-state";
import { appConfig } from "./config";
import { supabase } from "./supabase";

export interface GoogleSignIn {
  /** Kicks off the Google prompt. Dispatches SIGN_IN_* events as it goes. */
  signIn: () => Promise<void>;
  /** Native SDK needs no async request setup. */
  ready: boolean;
  /** False when Supabase or the web client ID are missing/placeholders. */
  configured: boolean;
}

let googleConfigured = false;

function ensureGoogleConfigured(): void {
  if (googleConfigured) return;
  GoogleSignin.configure({
    // The idToken audience: must be the WEB client ID (it is what Supabase
    // verifies against its Authorized Client IDs list). The Android client is
    // matched implicitly by package name + SHA-1; iOS uses iosClientId.
    webClientId: appConfig.googleWebClientId ?? undefined,
    iosClientId: appConfig.googleIosClientId ?? undefined,
  });
  googleConfigured = true;
}

export function useGoogleSignIn(dispatch: (event: AuthEvent) => void): GoogleSignIn {
  const configured = useMemo(
    () => appConfig.missing.length === 0 && Boolean(appConfig.googleWebClientId),
    [],
  );

  const signIn = useCallback(async () => {
    dispatch({ type: "SIGN_IN_STARTED" });
    try {
      ensureGoogleConfigured();
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await GoogleSignin.signIn();
      const extracted = idTokenFromNativeSignIn(result);
      if (!extracted.ok) {
        if (extracted.reason === "error") {
          console.error("[auth] Google sign-in returned no idToken:", result?.type);
        }
        dispatch({
          type: extracted.reason === "dismissed" ? "SIGN_IN_DISMISSED" : "SIGN_IN_FAILED",
        });
        return;
      }
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: extracted.idToken,
      });
      if (error) {
        console.error("[auth] signInWithIdToken failed:", error.message);
        dispatch({ type: "SIGN_IN_FAILED" });
      }
      // On success, App.tsx's onAuthStateChange listener dispatches
      // SESSION_CHANGED — nothing to do here.
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === statusCodes.SIGN_IN_CANCELLED) {
        dispatch({ type: "SIGN_IN_DISMISSED" });
        return;
      }
      console.error("[auth] Google sign-in failed:", err);
      dispatch({ type: "SIGN_IN_FAILED" });
    }
  }, [dispatch]);

  return { signIn, ready: true, configured };
}

export async function signOut(): Promise<void> {
  // Best-effort native sign-out so the account picker shows next time.
  try {
    ensureGoogleConfigured();
    await GoogleSignin.signOut();
  } catch {
    // Non-fatal; Supabase sign-out below is what ends the session.
  }
  const { error } = await supabase.auth.signOut();
  if (error) {
    // Local session is cleared regardless; server-side revoke failure is
    // logged and swallowed (generic-errors rule).
    console.error("[auth] signOut failed:", error.message);
  }
}
