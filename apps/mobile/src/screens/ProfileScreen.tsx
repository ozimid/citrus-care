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
  insufficientStorageMessage,
  localEngineStatusLabel,
  localEngineSubtitle,
  localModelDownloadWarning,
  localModelRequirements,
  modelWeightsLikelyPresent,
} from "../lib/local-engine";
import { availableDiskSpaceBytes, deviceCapabilitySnapshot } from "../lib/local-engine-io";
import {
  MODEL_CATALOGUE,
  formatModelBytes,
  hasRoomFor,
  modelAttribution,
  modelLicenceLinks,
  modelSpec,
  modelTestingNote,
  modelThatFits,
  type ModelId,
} from "../lib/model-catalogue";
import { deleteModelWeights, modelWeightsBytes } from "../lib/model-choice-io";
import { BACKUP_IMPORT_INVALID, exportBackup, importBackup } from "../lib/backup-io";
import { exportPlantsCsv } from "../lib/csv-export-io";
import { pendingCount } from "../lib/photo-queue";
import { loadPhotoQueue } from "../lib/photo-queue-io";
import { totalPhotoUsageBytes } from "../lib/photo-store-io";
import { storageSummary } from "../lib/storage-budget";
import { measureRecordBytes } from "../lib/storage-budget-io";
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

      <ModelCard />

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
 * without overwriting anything already here. Photos stay on the phone. F39
 * (D-W17): one line says how full the phone's record store and photo folder
 * are — the 6 MB Android AsyncStorage default is a real cliff. */
function DataCard() {
  const { t } = useTheme();
  const [busy, setBusy] = useState<null | "export" | "import" | "csv">(null);
  /** "Records: 1.2 of 6 MB · Photos: 412 MB" — null until measured / on failure. */
  const [storageLine, setStorageLine] = useState<string | null>(null);
  /** F39 / D-W11: photos still waiting for analysis are NOT in the backup. */
  const [pending, setPending] = useState(0);

  const loadStorage = useCallback(async () => {
    try {
      const records = await measureRecordBytes();
      setStorageLine(storageSummary(records, totalPhotoUsageBytes()));
      setPending(pendingCount(await loadPhotoQueue()));
    } catch (e) {
      // Best-effort: a card without the line beats a card that fails to load.
      console.error("[ProfileScreen] storage measurement failed:", (e as Error).message);
      setStorageLine(null);
    }
  }, []);

  useEffect(() => {
    loadStorage();
  }, [loadStorage]);

  async function onExport() {
    setBusy("export");
    try {
      const { shared, included, total } = await exportBackup();
      // Honest about the byte cap (D-W11): the newest photos travel, the rest
      // stay on this phone. Unchanged copy when everything fit.
      const photosNote =
        included < total ? `Backup includes ${included} of ${total} photos (the newest).` : null;
      if (!shared) {
        Alert.alert(
          "Backup saved",
          ["Sharing isn't available on this device.", photosNote].filter(Boolean).join(" "),
        );
      } else if (photosNote) {
        Alert.alert("Backup exported", photosNote);
      }
    } catch (e) {
      console.error("[ProfileScreen] export failed:", (e as Error).message);
      Alert.alert("Couldn't export", "Something went wrong creating the backup. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  /** F39 Phase 6c: the plant ↔ tag ↔ zone map as a spreadsheet — the "backup
   * system in a safe spot" the research says every tagged garden needs
   * (tags fade, blow away, get chewed). Not a restore path: the JSON is. */
  async function onExportCsv() {
    setBusy("csv");
    try {
      const { shared } = await exportPlantsCsv();
      if (!shared) {
        Alert.alert("Spreadsheet saved", "Sharing isn't available on this device.");
      }
    } catch (e) {
      console.error("[ProfileScreen] CSV export failed:", (e as Error).message);
      Alert.alert("Couldn't export", "Something went wrong creating the spreadsheet. Please try again.");
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
      void loadStorage();
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.label, { color: t.sub }]}>Your data</Text>
      <Text style={[styles.dataBody, { color: t.sub }]}>
        Everything lives on this phone — and it&apos;s gone if you lose it. Export a backup of your
        plants, history, photos and the questions you&apos;ve asked about each plant, so you can
        restore it all later. The file is yours: it isn&apos;t sent anywhere.
      </Text>
      {storageLine ? (
        <Text style={[styles.dataBody, { color: t.sub }]} accessibilityLabel={`Storage: ${storageLine}`}>
          {storageLine}
        </Text>
      ) : null}
      {pending > 0 ? (
        <Text style={[styles.dataBody, { color: t.text }]}>
          Photos still waiting for analysis aren&apos;t included in a backup — analyze or remove them
          first.
        </Text>
      ) : null}
      <View style={styles.dataRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Export a backup of my data"
          disabled={busy !== null}
          onPress={onExport}
          style={[styles.dataButton, { borderColor: t.border, opacity: busy ? 0.6 : 1 }]}
        >
          {busy === "export" ? (
            <ActivityIndicator color={t.sub} />
          ) : (
            <Text style={[styles.dataButtonText, { color: t.text }]}>Export backup</Text>
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
      {/* Which of the two "export" buttons restores your garden is the whole
          question here, so it is answered BEFORE the second one, at body
          weight — not in a footnote under it. */}
      <Text style={[styles.dataBody, styles.csvNote, { color: t.sub }]}>
        A spreadsheet of your plants, tags and zones — for your own records. It can&apos;t be
        imported back; Export backup is the one that restores everything.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Export a spreadsheet of my plants"
        disabled={busy !== null}
        onPress={onExportCsv}
        style={[styles.dataButton, styles.csvButton, { borderColor: t.border, opacity: busy ? 0.6 : 1 }]}
      >
        {busy === "csv" ? (
          <ActivityIndicator color={t.sub} />
        ) : (
          <Text style={[styles.dataButtonText, { color: t.text }]}>Export spreadsheet (CSV)</Text>
        )}
      </Pressable>
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
 * requirements and checks free space BEFORE the download (once), then reports
 * the session state; a failed session is honest and retries on tap. F40: every
 * size here is the SELECTED model's, read from the catalogue. */
function LocalEngineCard() {
  const { t } = useTheme();
  const { state, settings, modelId, modelResolved, downloadedIds, setEnabled, retry } =
    useLocalEngine();
  const spec = modelSpec(modelId);
  // Per-model truth beats the old single "downloaded" flag — but the disk
  // listing degrades to [] on a read failure, so an empty listing falls back
  // to that flag rather than sending a legacy Gemma user into a free-space
  // check for a download that would never happen.
  const alreadyHere = modelWeightsLikelyPresent(modelId, downloadedIds, settings);

  function toggle(next: boolean) {
    // F33 pre-flight: incapable phones learn it here, not after a download.
    if (next) {
      const capability = deviceCapabilitySnapshot(modelId);
      if (capability.level === "block") {
        Alert.alert("This phone can't run the AI", capability.reason ?? undefined);
        return;
      }
    }
    if (!next || alreadyHere) {
      setEnabled(next);
      return;
    }
    // A phone with no room downloads gigabytes and then fails — check first.
    // Not an error: a full phone is a fact about the phone, so it is said once,
    // in the Alert, with the user's actual number, and never logged.
    const available = availableDiskSpaceBytes();
    if (available !== null && !hasRoomFor(modelId, available)) {
      // Name the model that WOULD fit — the Model card below is where they
      // switch to it, so the refusal stops being a dead end.
      Alert.alert(
        "Not enough space",
        insufficientStorageMessage(modelId, available, modelThatFits(modelId, available)),
        [{ text: "OK", style: "cancel" }],
      );
      return;
    }
    Alert.alert(`Download ${spec.label}?`, localModelDownloadWarning(modelId), [
      { text: "Not now", style: "cancel" },
      { text: `Download ${spec.sizeLabel}`, onPress: () => setEnabled(true) },
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
          // Off until the startup model resolve lands: enabling in that window
          // would persist a placeholder default as the user's explicit choice.
          disabled={!modelResolved}
          onValueChange={toggle}
          trackColor={{ true: t.green }}
        />
      </View>
      <Text style={[styles.engineSubtitle, { color: t.sub }]}>
        {localEngineSubtitle(state, settings, modelId)}
      </Text>
      {/* Stated up front, not after a multi-gigabyte download. */}
      <Text style={[styles.engineRequirements, { color: t.sub }]}>
        {localModelRequirements(modelId)}
      </Text>
      {failed ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Retry on-device model setup" onPress={retry} hitSlop={8}>
          <Text style={[styles.devRow, { color: t.green }]}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** F40 — which model this phone runs, what the other one would cost, and the
 * only way to get multi-gigabyte weights back off the phone. Everything
 * numeric comes from the catalogue; the attribution line is required by the
 * LFM Open License v1.0 and is simply true of both models. */
function ModelCard() {
  const { t } = useTheme();
  const { state, settings, modelId, modelResolved, setModelId, downloadedIds, refreshDownloaded } =
    useLocalEngine();
  const spec = modelSpec(modelId);
  const otherId =
    (Object.keys(MODEL_CATALOGUE) as ModelId[]).find((id) => id !== modelId) ?? modelId;
  const other = modelSpec(otherId);
  // The delete offer must only ever appear for weights this app positively
  // SAW, so it keeps the raw listing. Everything else uses the fallback.
  const otherOnPhone = downloadedIds.includes(otherId);
  const inUseOnPhone = modelWeightsLikelyPresent(modelId, downloadedIds, settings);
  /** Defensive: a one-model catalogue has nothing to switch to or free. */
  const hasAlternative = otherId !== modelId;
  /** Bytes the unused model is holding — measured, not the catalogue's figure,
   * because that is what the delete will actually hand back. */
  const [reclaimable, setReclaimable] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const measure = useCallback(async () => {
    if (!otherOnPhone) {
      setReclaimable(null);
      return;
    }
    try {
      setReclaimable(await modelWeightsBytes(otherId));
    } catch (e) {
      console.error("[ProfileScreen] model size read failed:", (e as Error).message);
      setReclaimable(null);
    }
  }, [otherId, otherOnPhone]);

  useEffect(() => {
    measure();
  }, [measure]);

  function switchModel() {
    // A switch mid-download would start the second download while the first
    // keeps writing to the cache directory — two downloads sized by one
    // free-space check, and the abandoned partial is invisible to "Free up
    // space" (that only lists the finished-weights directory).
    if (state.kind === "downloading") {
      Alert.alert(
        "A download is already running",
        `${spec.label} is still downloading. Let it finish, or turn the on-device AI off to stop it, then switch — starting a second download now would use the space twice.`,
      );
      return;
    }
    // The same F33 pre-flight the enable path runs: the RAM bar is per model,
    // so a phone that can run the light one may be unable to run the heavy
    // one — better to say so than to spend 4.4 GB finding out.
    const capability = deviceCapabilitySnapshot(otherId);
    if (capability.level === "block") {
      Alert.alert("This phone can't run that model", capability.reason ?? undefined);
      return;
    }
    const warnPrefix =
      capability.level === "warn" && capability.reason ? capability.reason + "\n\n" : "";
    if (!otherOnPhone) {
      const available = availableDiskSpaceBytes();
      if (available !== null && !hasRoomFor(otherId, available)) {
        Alert.alert(
          "Not enough space",
          insufficientStorageMessage(otherId, available, modelThatFits(otherId, available)),
          [{ text: "OK", style: "cancel" }],
        );
        return;
      }
    }
    const cost = otherOnPhone
      ? `${other.label} is already on this phone — nothing to download.`
      : `This downloads ${other.label}: ${other.sizeLabel} over Wi-Fi, once.`;
    Alert.alert(
      `Switch to ${other.label}?`,
      warnPrefix +
        `${cost}\n\n` +
        `Diagnoses you already have were made by ${spec.label}. They stay exactly as they are — a new reading from ${other.label} is a different model's opinion, not a correction of the old one.\n\n` +
        // The forward consequence, which is the one that actually bites: the
        // trend is computed from health scores alone (assessment-store's
        // withComputedComparison), and nothing records which model scored one.
        `Better, same or worse is worked out by comparing health scores. Your next diagnosis will be scored by ${other.label} and compared against a score from ${spec.label} — the first comparison after a switch may say more about the models than about the plant.\n\n` +
        `${spec.label} stays on this phone until you free the space.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Switch", onPress: () => setModelId(otherId) },
      ],
    );
  }

  function confirmFreeUp() {
    const size = reclaimable !== null ? formatModelBytes(reclaimable) : other.sizeLabel;
    // Don't promise "everything keeps working" when the model in use hasn't
    // finished downloading — that is exactly the moment the promise is false.
    const consequence = inUseOnPhone
      ? `${other.label} isn't in use — ${spec.label} keeps running.`
      : `${other.label} isn't in use, but ${spec.label} isn't downloaded yet either: until it finishes, no diagnosis can run.`;
    Alert.alert(
      `Delete ${other.label}?`,
      `Frees about ${size}. ${consequence} Your plants, photos and history are untouched, and you can download ${other.label} again later.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: `Free ${size}`, style: "destructive", onPress: freeUp },
      ],
    );
  }

  async function freeUp() {
    setBusy(true);
    const size = reclaimable !== null ? formatModelBytes(reclaimable) : other.sizeLabel;
    try {
      // The live model is passed in, not re-derived: the guard must compare
      // against what is actually mounted, not a second read that could differ.
      await deleteModelWeights(otherId, modelId);
      Alert.alert("Space freed", `${other.label} was removed from this phone — about ${size}.`);
    } catch (e) {
      console.error("[ProfileScreen] freeing model weights failed:", (e as Error).message);
      Alert.alert(
        "Couldn't free the space",
        "Something went wrong removing those files. Please try again.",
      );
    } finally {
      setBusy(false);
      refreshDownloaded();
      void measure();
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.label, { color: t.sub }]}>Model</Text>
      <View style={styles.engineRow}>
        <Text style={[styles.engineStatus, { color: t.text }]} numberOfLines={1}>
          {spec.label}
        </Text>
        <Text style={[styles.modelSize, { color: t.green }]}>In use · {spec.sizeLabel}</Text>
      </View>
      <Text style={[styles.engineSubtitle, { color: t.sub }]}>
        {spec.maker} · {spec.licence} · {spec.blurb}
      </Text>
      <Text style={[styles.engineSubtitle, { color: t.sub }]}>
        {inUseOnPhone
          ? "Its files are on this phone."
          : "Its files aren't on this phone yet — turning the AI on downloads them."}
      </Text>

      {hasAlternative ? (
        <>
          <Text style={[styles.modelOther, { color: t.text }]}>
            The other option: {other.label} — {other.maker}, {other.licence},{" "}
            {otherOnPhone ? "already on this phone" : other.sizeLabel}. {other.blurb}
          </Text>
          {/* The one claim that must never be made here is "better" — and the
              parity claim that used to sit here was just as unmeasured. */}
          <Text style={[styles.engineRequirements, { color: t.sub }]}>{modelTestingNote()}</Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Switch to ${other.label}`}
            disabled={busy || !modelResolved}
            onPress={switchModel}
            style={[
              styles.dataButton,
              styles.modelButton,
              { borderColor: t.border, opacity: busy || !modelResolved ? 0.6 : 1 },
            ]}
          >
            <Text style={[styles.dataButtonText, { color: t.text }]}>
              Switch to {other.label}
              {otherOnPhone ? "" : ` · ${other.sizeLabel}`}
            </Text>
          </Pressable>

          {/* The user this feature exists for is the one already holding the
              heavy model: they see a Switch button and no way to the space.
              Say the sequence here, where they are, not only inside the switch
              confirmation they have not opened. */}
          {inUseOnPhone && !otherOnPhone ? (
            <Text style={[styles.engineRequirements, { color: t.sub }]}>
              To free {spec.sizeLabel}, switch to {other.label} first — a model that&apos;s in use
              can&apos;t be deleted.
            </Text>
          ) : null}

          {/* Only shown when those files were positively found on this phone —
              never an offer to delete something we couldn't see. */}
          {otherOnPhone ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Free up space by deleting ${other.label}`}
              disabled={busy}
              onPress={confirmFreeUp}
              style={[
                styles.dataButton,
                styles.destructiveButton,
                { borderColor: t.danger, opacity: busy ? 0.6 : 1 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color={t.danger} />
              ) : (
                <Text style={[styles.dataButtonText, { color: t.danger }]}>
                  Free up {reclaimable !== null ? formatModelBytes(reclaimable) : other.sizeLabel}{" "}
                  — delete {other.label}
                </Text>
              )}
            </Pressable>
          ) : null}
        </>
      ) : null}

      <Text style={[styles.engineRequirements, { color: t.sub }]}>{modelAttribution()}</Text>
      {/* Naming a licence the user can't open is hedging aimed at a lawyer.
          The LFM Open License v1.0 (§4(a), §4(d)) requires the licence and the
          notice to travel with the work — so each one is one tap away. Nothing
          is fetched until the user taps: the app still transmits nothing. */}
      {modelLicenceLinks().map((link) => (
        <Pressable
          key={link.id}
          accessibilityRole="link"
          accessibilityLabel={`Read the ${link.licence} for ${link.id}`}
          onPress={() => openLicence(link.url, link.licence)}
          hitSlop={6}
        >
          <Text style={[styles.devRow, { color: t.green }]}>{link.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Opens a model licence in the browser. A failure is a generic, honest
 * message with the address in it — never the raw platform error. */
function openLicence(url: string, licence: string) {
  Linking.openURL(url).catch((e) => {
    console.error("[ProfileScreen] licence link failed:", (e as Error).message);
    Alert.alert("Couldn't open the browser", `The ${licence} is published at ${url}.`);
  });
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
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  dataButtonText: { fontSize: 14, fontWeight: "600" },
  csvButton: { flex: 0 },
  csvNote: { marginTop: 10, marginBottom: 6 },
  engineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 32,
  },
  engineStatus: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  modelSize: { fontSize: 12, fontWeight: "700" },
  modelOther: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  modelButton: { flex: 0, marginTop: 8, paddingHorizontal: 12 },
  /** The delete sits apart from Switch on purpose: 8 px between two
   * same-shaped buttons, one destructive, is a mis-tap waiting to happen. */
  destructiveButton: { flex: 0, marginTop: 20, paddingHorizontal: 12 },
  engineSubtitle: { fontSize: 12, lineHeight: 17 },
  engineRequirements: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  devRow: { fontSize: 13, fontWeight: "600", paddingVertical: 6 },
  spikeFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  foot: { fontSize: 12, textAlign: "center", marginTop: 4 },
});
