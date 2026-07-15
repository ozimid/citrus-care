import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { signOut } from "../lib/auth";
import { RADIUS, useTheme } from "../lib/theme";

// Profile tab stub per the native design doc §3 — account + sign out today;
// reminders, units, and storage & privacy land with later features.

export function ProfileScreen({ email }: { email: string | null }) {
  const { t } = useTheme();
  const [busy, setBusy] = useState(false);

  return (
    <View style={[styles.container, { backgroundColor: t.canvas }]}>
      <Text style={[styles.heading, { color: t.text }]}>Profile</Text>
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.label, { color: t.sub }]}>Signed in as</Text>
        <Text style={[styles.email, { color: t.text }]}>{email ?? "—"}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          await signOut();
          // On success the auth listener flips the app back to Welcome and
          // unmounts this screen; no local state to reset.
          setBusy(false);
        }}
        style={[styles.signOut, { borderColor: t.danger, opacity: busy ? 0.6 : 1 }]}
      >
        {busy ? (
          <ActivityIndicator color={t.danger} />
        ) : (
          <Text style={[styles.signOutText, { color: t.danger }]}>Sign out</Text>
        )}
      </Pressable>
      <Text style={[styles.foot, { color: t.sub }]}>
        Reminders, units, and privacy settings are coming soon.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 68, paddingHorizontal: 20, gap: 14 },
  heading: { fontSize: 24, fontWeight: "600", letterSpacing: -0.4 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    padding: 16,
    gap: 4,
  },
  label: { fontSize: 12 },
  email: { fontSize: 15, fontWeight: "500" },
  signOut: {
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingVertical: 13,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  signOutText: { fontSize: 15, fontWeight: "600" },
  foot: { fontSize: 12, textAlign: "center", marginTop: 4 },
});
