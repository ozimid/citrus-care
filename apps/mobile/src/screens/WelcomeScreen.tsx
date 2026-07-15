import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useGoogleSignIn } from "../lib/auth";
import type { AuthEvent } from "../lib/auth-state";
import { RADIUS, useTheme } from "../lib/theme";

// Welcome screen per the native design doc (§4: landing/login/signup collapse
// into one screen — brand + Google button). Visuals unchanged from the
// original scaffold; the button is now wired to the Google sign-in flow.

interface Props {
  phase: "signedOut" | "signingIn";
  error: string | null;
  dispatch: (event: AuthEvent) => void;
}

export function WelcomeScreen({ phase, error, dispatch }: Props) {
  const { t } = useTheme();
  const { signIn, ready, configured } = useGoogleSignIn(dispatch);
  const busy = phase === "signingIn";
  const disabled = busy || !ready || !configured;

  return (
    <View style={[styles.container, { backgroundColor: t.canvas }]}>
      <View style={[styles.mark, { backgroundColor: t.green }]}>
        <Text style={styles.markGlyph}>🍋</Text>
      </View>
      <Text style={[styles.title, { color: t.text }]}>Citrus Care</Text>
      <Text style={[styles.sub, { color: t.sub }]}>
        Snap a photo. Get a health score and a care plan in seconds.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
        style={[styles.cta, { backgroundColor: t.green, opacity: disabled ? 0.6 : 1 }]}
        disabled={disabled}
        onPress={signIn}
      >
        {busy ? (
          <ActivityIndicator color={t.onGreen} />
        ) : (
          <Text style={[styles.ctaText, { color: t.onGreen }]}>Continue with Google</Text>
        )}
      </Pressable>
      {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
      {!configured ? (
        <Text style={[styles.error, { color: t.sub }]}>
          App not configured yet — add Supabase and Google client IDs (see apps/mobile/README.md).
        </Text>
      ) : null}
      <Text style={[styles.foot, { color: t.sub }]}>
        Same account and plants as the web app.
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 14 },
  mark: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
  markGlyph: { fontSize: 40 },
  title: { fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
  sub: { fontSize: 15, textAlign: "center", lineHeight: 22, maxWidth: 280 },
  cta: {
    marginTop: 18,
    paddingVertical: 15,
    paddingHorizontal: 26,
    borderRadius: RADIUS,
    minWidth: 260,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { fontSize: 16, fontWeight: "600" },
  error: { fontSize: 13, textAlign: "center", maxWidth: 280, lineHeight: 18 },
  foot: { fontSize: 12, marginTop: 6 },
});
