import * as Application from "expo-application";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { apiOrigin } from "../lib/api-io";
import { signOut } from "../lib/auth";
import { cancelReminder, mapScheduledReminders, type ReminderListItem } from "../lib/reminders";
import { notificationScheduler } from "../lib/reminders-io";
import { RADIUS, useTheme } from "../lib/theme";

// Profile tab per the native design doc §3 — account, scheduled re-assessment
// reminders (local notifications; listed + cancellable), read-only About rows
// (app version + resolved API origin, for debuggability), sign out. Units and
// storage & privacy land with later features.

export function ProfileScreen({ email }: { email: string | null }) {
  const { t } = useTheme();
  const [busy, setBusy] = useState(false);
  const [reminders, setReminders] = useState<ReminderListItem[] | null>(null);

  const loadReminders = useCallback(async () => {
    try {
      setReminders(mapScheduledReminders(await notificationScheduler.getScheduled()));
    } catch (e) {
      // Show the empty state rather than an error — reminders are best-effort.
      console.error("[ProfileScreen] loading reminders failed:", (e as Error).message);
      setReminders([]);
    }
  }, []);

  useEffect(() => {
    loadReminders();
  }, [loadReminders]);

  async function cancel(id: string) {
    try {
      await cancelReminder(notificationScheduler, id);
    } catch (e) {
      console.error("[ProfileScreen] cancelling reminder failed:", (e as Error).message);
    }
    loadReminders();
  }

  return (
    <View style={[styles.container, { backgroundColor: t.canvas }]}>
      <Text style={[styles.heading, { color: t.text }]}>Profile</Text>
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.label, { color: t.sub }]}>Signed in as</Text>
        <Text style={[styles.email, { color: t.text }]}>{email ?? "—"}</Text>
      </View>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.label, { color: t.sub }]}>Reminders</Text>
        {reminders === null ? (
          <ActivityIndicator color={t.green} />
        ) : reminders.length === 0 ? (
          <Text style={[styles.remindersEmpty, { color: t.sub }]}>
            None scheduled. Set one from a diagnosis to get a re-check nudge.
          </Text>
        ) : (
          reminders.map((r) => (
            <View key={r.id} style={styles.reminderRow}>
              <Text style={[styles.reminderText, { color: t.text }]} numberOfLines={1}>
                🔔 {r.plantName} · {r.dateLabel}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Cancel reminder for ${r.plantName}`}
                onPress={() => cancel(r.id)}
                hitSlop={8}
              >
                <Text style={[styles.reminderCancel, { color: t.danger }]}>Cancel</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.label, { color: t.sub }]}>About</Text>
        <View style={styles.aboutRow}>
          <Text style={[styles.aboutKey, { color: t.sub }]}>App version</Text>
          <Text style={[styles.aboutValue, { color: t.text }]} numberOfLines={1}>
            {Application.nativeApplicationVersion ?? "—"}
          </Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={[styles.aboutKey, { color: t.sub }]}>API origin</Text>
          <Text style={[styles.aboutValue, { color: t.text }]} numberOfLines={1}>
            {apiOrigin}
          </Text>
        </View>
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
        Reminders are on-device notifications; units and privacy settings are coming soon.
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
  remindersEmpty: { fontSize: 13, lineHeight: 19 },
  reminderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 4,
  },
  reminderText: { fontSize: 14, fontWeight: "500", flexShrink: 1 },
  reminderCancel: { fontSize: 13, fontWeight: "600" },
  aboutRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 3,
  },
  aboutKey: { fontSize: 13 },
  aboutValue: { fontSize: 13, fontWeight: "500", flexShrink: 1 },
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
