import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { RoundButton } from "../components/CaptureOverlay";
import { useLocalEngine } from "../components/LocalEngineProvider";
import { apiFetch } from "../lib/api-io";
import {
  fetchDiagnosisRow,
  friendlyAssessError,
  runAssess,
  type AssessPhase,
  type AssessResult,
} from "../lib/assess";
import { captureMode, type CaptureModeKey } from "../lib/capture-modes";
import { persistLocalAssessment } from "../lib/local-engine-io";
import { SPIKE_MAX_DIMENSION } from "../lib/photo";
import { downscalePhoto, type PreparedPhoto } from "../lib/photo-io";
import {
  linkPhotoToAssessment,
  readPhotoBase64,
  savePlantPhoto,
} from "../lib/photo-store-io";
import { supabase } from "../lib/supabase";
import { RADIUS, useTheme } from "../lib/theme";

// Post-capture review (design doc §3: capture → analyzing → result). The
// photo is already downscaled (1600px JPEG q0.85); "Analyze" runs the tested
// flow in lib/assess.ts (local save → on-device model if the user enabled it,
// else/on any failure a direct-image /assess → parsed diagnosis) and hands the
// result up to CaptureScreen, which shows DiagnosisScreen. The saved local uri
// is kept so a retry skips the re-save.

// Deliberately engine-neutral: escalation from the local model to Gemini is
// silent (D-15 Stage 2), so the label must not promise either one.
const PHASE_LABEL: Record<AssessPhase, string> = {
  saving: "Saving photo…",
  analyzing: "Analyzing…",
};

interface Props {
  photo: PreparedPhoto;
  plantId: string;
  plantName: string;
  mode: CaptureModeKey;
  onRetake: () => void;
  onClose: () => void;
  onAssessed: (result: AssessResult) => void;
}

export function ReviewScreen({ photo, plantId, plantName, mode, onRetake, onClose, onAssessed }: Props) {
  const { t } = useTheme();
  const localEngine = useLocalEngine();
  const [phase, setPhase] = useState<AssessPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Durable local uri kept for retry without re-saving the same photo. */
  const [savedUri, setSavedUri] = useState<string | null>(null);
  const busy = phase !== null;

  const analyze = useCallback(async () => {
    setError(null);
    try {
      const result = await runAssess(
        {
          api: apiFetch,
          savePhoto: savePlantPhoto,
          readPhotoBase64,
          linkPhoto: linkPhotoToAssessment,
          loadDiagnosis: (id) => fetchDiagnosisRow(supabase, id),
          local: {
            isReady: localEngine.isReady,
            // 512px long edge for the local model (the saved copy has this
            // photo's already-known dimensions); /assess still gets the 1600px.
            prepare: async (uri) =>
              (
                await downscalePhoto(
                  uri,
                  { width: photo.width, height: photo.height },
                  SPIKE_MAX_DIMENSION,
                )
              ).uri,
            generate: localEngine.generate,
            // An on-device result isn't persisted by /assess (that runs
            // Gemini) — the phone inserts the row itself, RLS-scoped.
            persist: (args) => persistLocalAssessment(supabase, args),
          },
        },
        { plantId, photoUri: photo.uri, isCutCare: mode === "cut", savedUri },
        { onPhase: setPhase, onPhotoSaved: setSavedUri },
      );
      onAssessed(result);
    } catch (e) {
      // Details were logged where they occurred; the UI gets only the friendly string.
      setError(friendlyAssessError(e));
    } finally {
      setPhase(null);
    }
  }, [localEngine, mode, onAssessed, photo.height, photo.uri, photo.width, plantId, savedUri]);

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
            🪴 {plantName} · {captureMode(mode).label}
          </Text>
        </View>
        <RoundButton label="Close" glyph="✕" disabled={busy} onPress={onClose} />
      </View>
      <View style={styles.bottomArea}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={busy ? PHASE_LABEL[phase] : error ? "Try again" : "Analyze"}
          disabled={busy}
          onPress={analyze}
          style={[styles.analyze, { backgroundColor: t.green, opacity: busy ? 0.75 : 1 }]}
        >
          {busy ? (
            <View style={styles.analyzeBusy}>
              <ActivityIndicator color={t.onGreen} />
              <Text style={[styles.analyzeText, { color: t.onGreen }]}>{PHASE_LABEL[phase]}</Text>
            </View>
          ) : (
            <Text style={[styles.analyzeText, { color: t.onGreen }]}>
              {error ? "Try again" : "Analyze"}
            </Text>
          )}
        </Pressable>
        {savedUri && !busy ? (
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
