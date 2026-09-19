import * as Application from "expo-application";
import { File } from "expo-file-system";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { buildAssessDeps } from "../components/assess-deps";
import { RoundButton } from "../components/CaptureOverlay";
import { useLocalEngine } from "../components/LocalEngineProvider";
import { NewPlantSheet } from "../components/NewPlantSheet";
import {
  friendlyAssessError,
  persistDeferredAssessment,
  runAssess,
  runDiagnoseOnly,
  type AssessDebugInfo,
  type AssessPhase,
  type AssessedResult,
  type RejectedResult,
} from "../lib/assess";
import { saveLastAssessDebug } from "../lib/assess-debug-io";
import { useKeepAwakeWhile } from "../lib/keep-awake-io";
import { prefillFromDiagnosis } from "../lib/new-plant";
import type { PreparedPhoto } from "../lib/photo-io";
import { loadDiagnosisContext } from "../lib/plants-io";
import { buildAssessDebugMailto } from "../lib/support";
import type { AssessmentDiagnosis } from "@citrus/shared";
import { RADIUS } from "../lib/theme";
import { useTheme } from "../lib/theme-io";

// Post-capture review (design doc §3: capture → analyzing → result). The photo
// is already downscaled (1600px JPEG q0.85); "Analyze" runs the tested flow in
// lib/assess.ts (local save → on-device Gemma → parsed diagnosis) and hands the
// result up to CaptureScreen, which shows DiagnosisScreen. The saved local uri
// is kept so a retry skips the re-save. D-17: Gemma is the only engine, so a
// phone that can't run it gets an honest, retryable error. The dependency
// wiring lives in components/assess-deps.ts and the prompt context loader in
// plants-io.ts so a batch runner can reuse both per photo.

const PHASE_LABEL: Record<AssessPhase, string> = {
  saving: "Saving photo…",
  analyzing: "Analyzing on this phone…",
};

// First inference on a cold model is legitimately slow — say so rather than
// leaving the user staring at a spinner (there is no cloud to fall back to).
const SLOW_LABEL = "Still analyzing — the first one takes longer…";
const SAVE_LATER_ERROR = "Couldn't save that photo. Please try again.";

interface Props {
  photo: PreparedPhoto;
  /** Null = F35 snap-first: no plant yet — diagnose, then the AI-drafted
   * new-plant sheet creates one before anything persists. */
  plantId: string | null;
  plantName: string | null;
  onRetake: () => void;
  onClose: () => void;
  /** `plant` is set when the assessment landed on a just-created plant. */
  onAssessed: (result: AssessedResult, plant?: { id: string; name: string }) => void;
  /** F39: queue the photo instead of analyzing it now (D-W7 "Later"). The
   * parent moves it into the durable queue and leaves; a throw shows the
   * generic error here. Absent = no pill. */
  onSaveForLater?: () => Promise<void>;
}

export function ReviewScreen({
  photo,
  plantId,
  plantName,
  onRetake,
  onClose,
  onAssessed,
  onSaveForLater,
}: Props) {
  const { t } = useTheme();
  const localEngine = useLocalEngine();
  const [phase, setPhase] = useState<AssessPhase | null>(null);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Durable local uri kept for retry without re-saving the same photo. */
  const [savedUri, setSavedUri] = useState<string | null>(null);
  /** F21: the model read a non-plant and nothing was saved. The photo is
   * still on the phone; the user decides whether to keep the assessment. */
  const [rejection, setRejection] = useState<RejectedResult | null>(null);
  /** Synchronous re-entry guard: analyze() awaits the context load before any
   * phase fires, which opened a multi-frame double-tap window (adversarial
   * critic). */
  const inFlightRef = useRef(false);
  /** The last run's record, for the user-tapped details share. */
  const [debug, setDebug] = useState<AssessDebugInfo | null>(null);
  /** F35: a finished diagnosis waiting for its plant (sheet open). */
  const [deferred, setDeferred] = useState<{ diagnosis: AssessmentDiagnosis; raw: string } | null>(
    null,
  );
  /** F39: the "Save for later" enqueue is in flight. */
  const [saving, setSaving] = useState(false);
  const busy = phase !== null;
  /** Nothing else may start while either the analysis or the save runs. */
  const locked = busy || saving;
  const busyLabel = slow ? SLOW_LABEL : phase ? PHASE_LABEL[phase] : "";

  // A 25-120 s run against a 30 s screen timeout: hold the screen while the
  // phone works (tagged so it never fights the download's or pruning's hold).
  useKeepAwakeWhile(busy, "assess");

  /** Once the durable copy exists, the manipulator's temp JPEG at photo.uri is
   * cache weight only — dropped on the way out (close/retake), never before
   * the save, so the preview and a retry always have their file. Best-effort. */
  const leave = useCallback(
    (next: () => void) => {
      if (savedUri && savedUri !== photo.uri) {
        try {
          const temp = new File(photo.uri);
          if (temp.exists) temp.delete();
        } catch (e) {
          console.error("[ReviewScreen] temp photo cleanup failed:", (e as Error).message);
        }
      }
      next();
    },
    [photo.uri, savedUri],
  );

  const analyze = useCallback(async (force = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    setRejection(null);
    setSlow(false);
    setDebug(null);
    try {
      // #4 — the plant's own record, folded into the diagnosis prompt so the
      // model ranks causes with triage pre-answered (empty for snap-first).
      const context = plantId ? await loadDiagnosisContext(plantId) : "";
      const deps = buildAssessDeps(localEngine, { width: photo.width, height: photo.height }, context);
      if (plantId === null) {
        // F35 snap-first: diagnose only — nothing is saved until the user
        // confirms the AI-drafted plant in the sheet.
        const result = await runDiagnoseOnly(
          deps,
          { photoUri: photo.uri, force },
          { onPhase: setPhase, onSlow: () => setSlow(true), onDebug: (d) => { setDebug(d); void saveLastAssessDebug(d); } },
        );
        if (result.status === "rejected") {
          setRejection({ status: "rejected", diagnosis: result.diagnosis, localUri: photo.uri });
          return;
        }
        setDeferred({ diagnosis: result.diagnosis, raw: result.raw });
        return;
      }
      const result = await runAssess(
        deps,
        { plantId, photoUri: photo.uri, savedUri, force },
        {
          onPhase: setPhase,
          onPhotoSaved: setSavedUri,
          onSlow: () => setSlow(true),
          onDebug: (d) => {
            setDebug(d);
            void saveLastAssessDebug(d);
          },
        },
      );
      if (result.status === "rejected") {
        setRejection(result);
        return;
      }
      onAssessed(result);
    } catch (e) {
      // Details were logged where they occurred; the UI gets only the friendly string.
      setError(friendlyAssessError(e));
    } finally {
      inFlightRef.current = false;
      setPhase(null);
      setSlow(false);
    }
  }, [localEngine, onAssessed, photo.height, photo.uri, photo.width, plantId, savedUri]);

  const saveForLater = useCallback(async () => {
    if (!onSaveForLater || inFlightRef.current) return;
    inFlightRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSaveForLater();
    } catch (e) {
      console.error("[ReviewScreen] save for later failed:", (e as Error).message);
      setError(SAVE_LATER_ERROR);
    } finally {
      inFlightRef.current = false;
      setSaving(false);
    }
  }, [onSaveForLater]);

  /** F35: the user saved the drafted plant — now persist photo + assessment. */
  const completeDeferred = useCallback(
    async (newPlantId: string, name: string) => {
      if (!deferred) return;
      setError(null);
      try {
        let localUri = photo.uri;
        const assessmentId = await persistDeferredAssessment(
          // No prompt context here: the diagnosis already exists, only the
          // photo copy and the row are written.
          buildAssessDeps(localEngine, { width: photo.width, height: photo.height }, ""),
          { plantId: newPlantId, photoUri: photo.uri, diagnosis: deferred.diagnosis, raw: deferred.raw },
          { onPhase: setPhase, onPhotoSaved: (u) => { localUri = u; } },
        );
        setDeferred(null);
        onAssessed(
          { status: "assessed", assessmentId, diagnosis: deferred.diagnosis, localUri },
          { id: newPlantId, name },
        );
      } catch (e) {
        // The plant exists; only the assessment write failed. Honest + retryable
        // via Analyze once the user reopens capture for that plant.
        setDeferred(null);
        setError(friendlyAssessError(e));
      } finally {
        setPhase(null);
      }
    },
    [deferred, localEngine, onAssessed, photo.height, photo.uri, photo.width],
  );

  return (
    <View style={styles.root}>
      <Image
        source={{ uri: photo.uri }}
        style={StyleSheet.absoluteFill}
        resizeMode="contain"
        accessibilityLabel="Captured photo"
      />
      <View style={styles.topBar}>
        <RoundButton label="Retake" glyph="‹" disabled={locked} onPress={() => leave(onRetake)} />
        <View style={styles.chip}>
          <Text style={styles.chipText} numberOfLines={1}>
            {plantName ? `🪴 ${plantName}` : "New plant ✨"}
          </Text>
        </View>
        <RoundButton label="Close" glyph="✕" disabled={locked} onPress={() => leave(onClose)} />
      </View>
      <View style={styles.bottomArea}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {error && debug ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Email the run details to feedback"
            onPress={() =>
              Linking.openURL(
                buildAssessDebugMailto(Application.nativeApplicationVersion, debug),
              ).catch((e) => console.error("[ReviewScreen] mailto failed:", (e as Error).message))
            }
            hitSlop={8}
            style={styles.saveAnyway}
          >
            <Text style={styles.saveAnywayText}>✉️ Send the details — helps fix it</Text>
          </Pressable>
        ) : null}
        {rejection && !busy ? (
          <View style={styles.rejection}>
            <Text style={styles.rejectionTitle}>That doesn&apos;t look like a plant</Text>
            <Text style={styles.rejectionBody}>
              {rejection.diagnosis.subject_note || rejection.diagnosis.summary}
            </Text>
            <Text style={styles.rejectionBody}>
              {plantName
                ? `Nothing was added to ${plantName}'s timeline. Retake the photo, or save it anyway if we got this wrong.`
                : "Nothing was saved. Retake the photo, or save it anyway if we got this wrong."}
            </Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            busy ? busyLabel : rejection ? "Retake photo" : error ? "Try again" : "Analyze"
          }
          disabled={locked}
          onPress={rejection ? () => leave(onRetake) : () => analyze()}
          style={[styles.analyze, { backgroundColor: t.green, opacity: locked ? 0.75 : 1 }]}
        >
          {busy ? (
            <View style={styles.analyzeBusy}>
              <ActivityIndicator color={t.onGreen} />
              <Text style={[styles.analyzeText, { color: t.onGreen }]}>{busyLabel}</Text>
            </View>
          ) : (
            <Text style={[styles.analyzeText, { color: t.onGreen }]}>
              {rejection ? "Retake" : error ? "Try again" : "Analyze"}
            </Text>
          )}
        </Pressable>
        {/* F39 / D-W7: the honest alternative to waiting here — the photo goes
            to the durable queue and is analyzed from the Plants tab later. */}
        {onSaveForLater && !rejection ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={plantId ? "Save for later" : "Save without a plant — pick one later"}
            accessibilityState={{ disabled: locked }}
            disabled={locked}
            onPress={saveForLater}
            style={[styles.later, { opacity: locked && !saving ? 0.5 : 1 }]}
          >
            {saving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.laterText}>
                {plantId ? "Save for later" : "Save without a plant — pick one later"}
              </Text>
            )}
          </Pressable>
        ) : null}
        {rejection && !busy ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save anyway"
            onPress={() => analyze(true)}
            style={styles.saveAnyway}
          >
            <Text style={styles.saveAnywayText}>Save anyway</Text>
          </Pressable>
        ) : null}
        {savedUri && !busy && !rejection ? (
          <Text style={styles.note}>Photo saved on this phone — retrying skips the save.</Text>
        ) : null}
      </View>
      {/* F35: the AI-drafted plant confirmation. Cancel keeps the diagnosis
          discarded (nothing was persisted) — same as closing capture. */}
      <NewPlantSheet
        visible={deferred !== null}
        prefill={deferred ? prefillFromDiagnosis(deferred.diagnosis) : null}
        onClose={() => setDeferred(null)}
        onSaved={completeDeferred}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 62,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  chip: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  bottomArea: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 42,
    paddingHorizontal: 24,
    gap: 12,
  },
  analyze: {
    borderRadius: RADIUS,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  analyzeBusy: { flexDirection: "row", alignItems: "center", gap: 10 },
  analyzeText: { fontSize: 16, fontWeight: "600" },
  later: {
    minHeight: 48,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.6)",
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  laterText: { color: "#ffffff", fontSize: 15, fontWeight: "600", textAlign: "center" },
  note: { color: "rgba(255,255,255,0.75)", fontSize: 12, textAlign: "center" },
  rejection: {
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: RADIUS,
    padding: 14,
    gap: 6,
  },
  rejectionTitle: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  rejectionBody: { color: "rgba(255,255,255,0.82)", fontSize: 13, lineHeight: 19 },
  saveAnyway: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  saveAnywayText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  error: {
    color: "#ffffff",
    backgroundColor: "rgba(220,38,38,0.85)",
    borderRadius: RADIUS,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    textAlign: "center",
    alignSelf: "center",
    overflow: "hidden",
  },
});
