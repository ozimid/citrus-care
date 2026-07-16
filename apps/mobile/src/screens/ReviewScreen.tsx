import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { RoundButton } from "../components/CaptureOverlay";
import { useLocalEngine } from "../components/LocalEngineProvider";
import {
  friendlyAssessError,
  runAssess,
  type AssessPhase,
  type AssessedResult,
  type RejectedResult,
} from "../lib/assess";
import { LOCAL_USER_PROMPT } from "../lib/local-engine";
import { persistLocalAssessment } from "../lib/local-engine-io";
import { SPIKE_MAX_DIMENSION } from "../lib/photo";
import { downscalePhoto, type PreparedPhoto } from "../lib/photo-io";
import { linkPhotoToAssessment, savePlantPhoto } from "../lib/photo-store-io";
import { SPIKE_SYSTEM_PROMPT } from "../lib/spike-vlm";
import { RADIUS } from "../lib/theme";
import { useTheme } from "../lib/theme-io";

// Post-capture review (design doc §3: capture → analyzing → result). The photo
// is already downscaled (1600px JPEG q0.85); "Analyze" runs the tested flow in
// lib/assess.ts (local save → on-device Gemma → parsed diagnosis) and hands the
// result up to CaptureScreen, which shows DiagnosisScreen. The saved local uri
// is kept so a retry skips the re-save. D-17: Gemma is the only engine, so a
// phone that can't run it gets an honest, retryable error.

const PHASE_LABEL: Record<AssessPhase, string> = {
  saving: "Saving photo…",
  analyzing: "Analyzing on this phone…",
};

// First inference on a cold model is legitimately slow — say so rather than
// leaving the user staring at a spinner (there is no cloud to fall back to).
const SLOW_LABEL = "Still analyzing — the first one takes longer…";

interface Props {
  photo: PreparedPhoto;
  plantId: string;
  plantName: string;
  onRetake: () => void;
  onClose: () => void;
  onAssessed: (result: AssessedResult) => void;
}

export function ReviewScreen({ photo, plantId, plantName, onRetake, onClose, onAssessed }: Props) {
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
  const busy = phase !== null;
  const busyLabel = slow ? SLOW_LABEL : phase ? PHASE_LABEL[phase] : "";

  const analyze = useCallback(async (force = false) => {
    setError(null);
    setRejection(null);
    setSlow(false);
    try {
      const result = await runAssess(
        {
          savePhoto: savePlantPhoto,
          linkPhoto: linkPhotoToAssessment,
          local: {
            isReady: localEngine.isReady,
            // 512px long edge for the local model (the saved copy has this
            // photo's already-known dimensions).
            prepare: async (uri) =>
              (
                await downscalePhoto(
                  uri,
                  { width: photo.width, height: photo.height },
                  SPIKE_MAX_DIMENSION,
                )
              ).uri,
            // The diagnosis prompts live in the pure lib modules; the session
            // is given them per call (F21: one prompt, the model reports subject).
            generate: ({ imageUri }) =>
              localEngine.generate({
                system: SPIKE_SYSTEM_PROMPT,
                user: LOCAL_USER_PROMPT,
                imageUri,
              }),
            interrupt: localEngine.interrupt,
            // The phone inserts the row itself into the local store.
            persist: persistLocalAssessment,
          },
        },
        { plantId, photoUri: photo.uri, savedUri, force },
        { onPhase: setPhase, onPhotoSaved: setSavedUri, onSlow: () => setSlow(true) },
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
      setPhase(null);
      setSlow(false);
    }
  }, [localEngine, onAssessed, photo.height, photo.uri, photo.width, plantId, savedUri]);

  return (
    <View style={styles.root}>
      <Image
        source={{ uri: photo.uri }}
        style={StyleSheet.absoluteFill}
        resizeMode="contain"
        accessibilityLabel="Captured photo"
      />
      <View style={styles.topBar}>
        <RoundButton label="Retake" glyph="‹" disabled={busy} onPress={onRetake} />
        <View style={styles.chip}>
          <Text style={styles.chipText} numberOfLines={1}>
            🪴 {plantName}
          </Text>
        </View>
        <RoundButton label="Close" glyph="✕" disabled={busy} onPress={onClose} />
      </View>
      <View style={styles.bottomArea}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {rejection && !busy ? (
          <View style={styles.rejection}>
            <Text style={styles.rejectionTitle}>That doesn&apos;t look like a plant</Text>
            <Text style={styles.rejectionBody}>
              {rejection.diagnosis.subject_note || rejection.diagnosis.summary}
            </Text>
            <Text style={styles.rejectionBody}>
              Nothing was added to {plantName}&apos;s timeline. Retake the photo, or save it anyway
              if we got this wrong.
            </Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            busy ? busyLabel : rejection ? "Retake photo" : error ? "Try again" : "Analyze"
          }
          disabled={busy}
          onPress={rejection ? onRetake : () => analyze()}
          style={[styles.analyze, { backgroundColor: t.green, opacity: busy ? 0.75 : 1 }]}
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
