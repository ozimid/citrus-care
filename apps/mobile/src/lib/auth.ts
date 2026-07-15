// Google sign-in: expo-auth-session Google provider -> id_token ->
// supabase.auth.signInWithIdToken. On native the provider runs an OAuth code
// flow against the platform client ID and auto-exchanges the code, surfacing
// the id_token in response.params. Success is observed via Supabase's
// onAuthStateChange listener (wired in App.tsx), not here.

import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect } from "react";
import { extractIdToken, type AuthEvent } from "./auth-state";
import { appConfig } from "./config";
import { supabase } from "./supabase";

WebBrowser.maybeCompleteAuthSession();

// The provider hook throws when no client ID exists for the platform; a dummy
// fallback keeps an unconfigured checkout renderable (the button is disabled
// via `configured` below).
const UNCONFIGURED_CLIENT_ID = "unconfigured.apps.googleusercontent.com";

export interface GoogleSignIn {
  /** Kicks off the Google prompt. Dispatches SIGN_IN_* events as it goes. */
  signIn: () => Promise<void>;
  /** False until the auth request has loaded. */
  ready: boolean;
  /** False when Supabase or Google client IDs are missing/placeholders. */
  configured: boolean;
}

export function useGoogleSignIn(dispatch: (event: AuthEvent) => void): GoogleSignIn {
  const configured =
    appConfig.missing.length === 0 &&
    Boolean(
      appConfig.googleWebClientId ||
        appConfig.googleIosClientId ||
        appConfig.googleAndroidClientId,
    );

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: appConfig.googleWebClientId ?? UNCONFIGURED_CLIENT_ID,
    webClientId: appConfig.googleWebClientId,
    iosClientId: appConfig.googleIosClientId,
    androidClientId: appConfig.googleAndroidClientId,
  });

  useEffect(() => {
    // "opened" is not a terminal result; wait for the real one.
    if (!response || response.type === "opened") return;

    const extracted = extractIdToken(response);
    if (!extracted.ok) {
      if (extracted.reason === "error") {
        console.error("[auth] Google auth did not return an id_token:", response.type);
      }
      dispatch({
        type: extracted.reason === "dismissed" ? "SIGN_IN_DISMISSED" : "SIGN_IN_FAILED",
      });
      return;
    }

    let cancelled = false;
    supabase.auth
      .signInWithIdToken({
        provider: "google",
        token: extracted.idToken,
        // Set only on flows where the provider generated one (web id_token
        // flow); Google echoes it into the token and Supabase verifies it.
        nonce: request?.nonce,
      })
      .then(({ error }) => {
        if (error) {
          console.error("[auth] signInWithIdToken failed:", error.message);
          if (!cancelled) dispatch({ type: "SIGN_IN_FAILED" });
        }
        // On success, App.tsx's onAuthStateChange listener dispatches
        // SESSION_CHANGED — nothing to do here.
      });
    return () => {
      cancelled = true;
    };
  }, [response, request, dispatch]);

  const signIn = useCallback(async () => {
    dispatch({ type: "SIGN_IN_STARTED" });
    try {
      await promptAsync();
      // Terminal results are handled by the response effect above.
    } catch (err) {
      console.error("[auth] Google prompt failed:", err);
      dispatch({ type: "SIGN_IN_FAILED" });
    }
  }, [dispatch, promptAsync]);

  return { signIn, ready: request !== null, configured };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    // Local session is cleared regardless; server-side revoke failure is
    // logged and swallowed (generic-errors rule).
    console.error("[auth] signOut failed:", error.message);
  }
}
