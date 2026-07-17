import * as Application from "expo-application";
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useLocalEngine } from "../components/LocalEngineProvider";
import {
  LOCAL_MODEL_DOWNLOAD_WARNING,
  LOCAL_MODEL_REQUIREMENTS,
  hasRoomForLocalModel,
  insufficientStorageMessage,
  localEngineStatusLabel,
  localEngineSubtitle,
  needsDownloadWarning,
} from "../lib/local-engine";
import { availableDiskSpaceBytes } from "../lib/local-engine-io";
import { BACKUP_IMPORT_INVALID, exportBackup, importBackup } from "../lib/backup-io";
import { cancelReminder, mapScheduledReminders, type ReminderListItem } from "../lib/reminders";
import { notificationScheduler } from "../lib/reminders-io";
import { BMC_URL, buildFeedbackMailto } from "../lib/support";
import { RADIUS } from "../lib/theme";
import { useTheme } from "../lib/theme-io";

// Profile tab (D-17): no account — data lives on the phone. Scheduled
// re-assessment reminders (local notifications; listed + cancellable), the
// on-device AI control, and read-only About rows.

// Lazily loaded on purpose: importing VlmSpikeScreen installs the
// react-native-executorch native runtime, which only exists in dev builds —
// a static import would crash the whole app in Expo Go at startup.
const VlmSpikeScreen = lazy(() =>
  import("./VlmSpikeScreen").then((m) => ({ default: m.VlmSpikeScreen })),
);

export function ProfileScreen() {
  const { t } = useTheme();
  const [reminders, setReminders] = useState<ReminderListItem[] | null>(null);
  const [spikeOpen, setSpikeOpen] = useState(false);

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
    // Scrollable since the Support card joined (2026-07-16): five cards no
    // longer fit one screen — About was clipped behind the tab bar.
    <ScrollView
      style={{ backgroundColor: t.canvas }}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.heading, { color: t.text }]}>Profile</Text>

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

      <LocalEngineCard />

      <DataCard />

      <SupportCard />

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.label, { color: t.sub }]}>About</Text>
        <View style={styles.aboutRow}>
          <Text style={[styles.aboutKey, { color: t.sub }]}>App version</Text>
          <Text style={[styles.aboutValue, { color: t.text }]} numberOfLines={1}>
            {Application.nativeApplicationVersion ?? "—"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the on-device model spike"
          onPress={() => setSpikeOpen(true)}
          hitSlop={8}
        >
          <Text style={[styles.devRow, { color: t.green }]}>Developer: on-device model spike</Text>
        </Pressable>
      </View>

      {/* D-15 Stage 1 spike, hidden behind the row above. Mounted only while
          open so the lazy executorch import never runs in normal use. */}
      {spikeOpen && (
        <Modal visible animationType="slide" onRequestClose={() => setSpikeOpen(false)}>
          <Suspense
            fallback={
              <View style={[styles.spikeFallback, { backgroundColor: t.canvas }]}>
                <ActivityIndicator color={t.green} />
              </View>
            }
          >
            <VlmSpikeScreen onClose={() => setSpikeOpen(false)} />
          </Suspense>
        </Modal>
      )}

      <Text style={[styles.foot, { color: t.sub }]}>
        Your plants, photos and history live only on this phone — nothing is sent to a server.
      </Text>
    </ScrollView>
  );
}

/** D-17: with nothing synced, a manual export is the only backup. Export writes
 * a JSON of your plants + history to the share sheet; import merges one back
 * without overwriting anything already here. Photos stay on the phone. */
function DataCard() {
  const { t } = useTheme();
  const [busy, setBusy] = useState<null | "export" | "import">(null);

  async function onExport() {
    setBusy("export");
    try {
      const shared = await exportBackup();
      if (!shared) Alert.alert("Backup saved", "Sharing isn't available on this device.");
    } catch (e) {
      console.error("[ProfileScreen] export failed:", (e as Error).message);
      Alert.alert("Couldn't export", "Something went wrong creating the backup. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onImport() {
    setBusy("import");
    try {
      const added = await importBackup();
      if (added) {
        Alert.alert(
          "Backup imported",
          `Added ${added.plants} plant${added.plants === 1 ? "" : "s"} and ${added.assessments} assessment${added.assessments === 1 ? "" : "s"}. Existing plants were kept as they are.`,
        );
      }
    } catch (e) {
      const message = (e as Error).message === BACKUP_IMPORT_INVALID ? BACKUP_IMPORT_INVALID : "Couldn't read that file. Please try again.";
      Alert.alert("Import failed", message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.label, { color: t.sub }]}>Your data</Text>
      <Text style={[styles.dataBody, { color: t.sub }]}>
        Everything lives on this phone — and it&apos;s gone if you lose it. Export a backup of your
        plants, history and photos so you can restore it all later.
      </Text>
      <View style={styles.dataRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Export my data"
          disabled={busy !== null}
          onPress={onExport}
          style={[styles.dataButton, { borderColor: t.border, opacity: busy ? 0.6 : 1 }]}
        >
          {busy === "export" ? (
            <ActivityIndicator color={t.sub} />
          ) : (
            <Text style={[styles.dataButtonText, { color: t.text }]}>Export</Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Import a backup"
          disabled={busy !== null}
          onPress={onImport}
          style={[styles.dataButton, { borderColor: t.border, opacity: busy ? 0.6 : 1 }]}
        >
          {busy === "import" ? (
            <ActivityIndicator color={t.sub} />
          ) : (
            <Text style={[styles.dataButtonText, { color: t.text }]}>Import</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/** Support & feedback — both rows are LINK-OUTS the user taps (mail app /
 * browser); the app itself sends nothing (D-17). The feedback draft carries
 * app + Android version because the user asked for troubleshooting context. */
function SupportCard() {
  const { t } = useTheme();

  function openFeedback() {
    const url = buildFeedbackMailto(Application.nativeApplicationVersion, Platform.Version);
    Linking.openURL(url).catch((e) => {
      console.error("[ProfileScreen] feedback mailto failed:", (e as Error).message);
      Alert.alert("Couldn't open your mail app", "You can email feedback@citruscare.net directly.");
    });
  }

  function openCoffee() {
    Linking.openURL(BMC_URL).catch((e) => {
      console.error("[ProfileScreen] coffee link failed:", (e as Error).message);
      Alert.alert("Couldn't open the browser", "The page is buymeacoffee.com/citruscare.");
    });
  }

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.label, { color: t.sub }]}>Support & feedback</Text>
      <Text style={[styles.dataBody, { color: t.sub }]}>
        Citrus Care is free and has no ads. Feedback and coffees both help.
      </Text>
      <View style={styles.dataRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Buy me a coffee"
          onPress={openCoffee}
          // Web parity (user feedback): the landing's BMC button is amber.
          style={[styles.dataButton, { borderColor: "#fbbf24", backgroundColor: "#fbbf24" }]}
        >
          <Text style={[styles.dataButtonText, { color: "#1c1917" }]}>☕ Buy me a coffee</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send feedback"
          onPress={openFeedback}
          style={[styles.dataButton, { borderColor: t.border }]}
        >
          <Text style={[styles.dataButtonText, { color: t.text }]}>Send feedback</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** D-17: the on-device engine is opt-in and reversible. The toggle states the
 * requirements and checks free space BEFORE the 1.3 GB download (once), then
 * reports the session state; a failed session is honest and retries on tap. */
function LocalEngineCard() {
  const { t } = useTheme();
  const { state, settings, setEnabled, retry } = useLocalEngine();

  function toggle(next: boolean) {
    if (!next || !needsDownloadWarning(settings)) {
      setEnabled(next);
      return;
    }
    // A phone with no room downloads 1.3 GB and then fails — check first. Not
    // an error: a full phone is a fact about the phone, so it is said once, in
    // the Alert, with the user's actual number, and never logged.
    const available = availableDiskSpaceBytes();
    if (available !== null && !hasRoomForLocalModel(available)) {
      Alert.alert("Not enough space", insufficientStorageMessage(available), [
        { text: "OK", style: "cancel" },
      ]);
      return;
    }
    Alert.alert("Download the on-device model?", LOCAL_MODEL_DOWNLOAD_WARNING, [
      { text: "Not now", style: "cancel" },
      { text: "Download", onPress: () => setEnabled(true) },
    ]);
  }

  const failed = state.kind === "failed" || state.kind === "crashed";
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.label, { color: t.sub }]}>On-device AI</Text>
      <View style={styles.engineRow}>
        <Text style={[styles.engineStatus, { color: failed ? t.danger : t.text }]}>
          {localEngineStatusLabel(state)}
        </Text>
        <Switch
          accessibilityLabel="On-device AI"
          value={settings.enabled}
          onValueChange={toggle}
          trackColor={{ true: t.green }}
        />
      </View>
      <Text style={[styles.engineSubtitle, { color: t.sub }]}>
        {localEngineSubtitle(state, settings)}
      </Text>
      {/* Stated up front, not after a 1.3 GB download. */}
      <Text style={[styles.engineRequirements, { color: t.sub }]}>{LOCAL_MODEL_REQUIREMENTS}</Text>
      {failed ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Retry on-device model setup" onPress={retry} hitSlop={8}>
          <Text style={[styles.devRow, { color: t.green }]}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: 68, paddingHorizontal: 20, paddingBottom: 110, gap: 14 },
  heading: { fontSize: 24, fontWeight: "600", letterSpacing: -0.4 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    padding: 16,
    gap: 4,
  },
  label: { fontSize: 12 },
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
  dataBody: { fontSize: 12, lineHeight: 17, marginBottom: 4 },
  dataRow: { flexDirection: "row", gap: 10, marginTop: 2 },
  dataButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  dataButtonText: { fontSize: 14, fontWeight: "600" },
  engineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 32,
  },
  engineStatus: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  engineSubtitle: { fontSize: 12, lineHeight: 17 },
  engineRequirements: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  devRow: { fontSize: 13, fontWeight: "600", paddingVertical: 6 },
  spikeFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  foot: { fontSize: 12, textAlign: "center", marginTop: 4 },
});
