import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { RoundButton } from "../components/CaptureOverlay";
import { apiFetch } from "../lib/api-io";
import {
  fetchDiagnosisRow,
  friendlyAssessError,
  runAssess,
  type AssessPhase,
  type AssessResult,
} from "../lib/assess";
import { captureMode, type CaptureModeKey } from "../lib/capture-modes";
import type { PreparedPhoto } from "../lib/photo-io";
import { supabase } from "../lib/supabase";
import { RADIUS, useTheme } from "../lib/theme";

// Post-capture review (design doc §3: capture → analyzing → result). The
// photo is already downscaled (1600px JPEG q0.85); "Analyze" runs the tested
// flow in lib/assess.ts (sign-upload → PUT → /assess → parsed diagnosis) and
// hands the result up to CaptureScreen, which shows DiagnosisScreen. A
// successfully uploaded photoPath is kept so a retry skips the re-upload.

const PHASE_LABEL: Record<AssessPhase, string> = {
  uploading: "Uploading…",
  analyzing: "Analyzing with Gemini…",
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
  const [phase, setPhase] = useState<AssessPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Uploaded path kept for retry without re-uploading the same photo (web parity). */
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const busy = phase !== null;

  const analyze = useCallback(async () => {
    setError(null);
    try {
      const result = await runAssess(
        {
          api: apiFetch,
          fetchRaw: (url, init) => fetch(url, init as RequestInit),
          loadDiagnosis: (id) => fetchDiagnosisRow(supabase, id),
        },
        { plantId, photoUri: photo.uri, isCutCare: mode === "cut", photoPath: uploadedPath },
        { onPhase: setPhase, onPhotoUploaded: setUploadedPath },
      );
      onAssessed(result);
    } catch (e) {
      // Details were logged where they occurred; the UI gets only the friendly string.
      setError(friendlyAssessError(e));
    } finally {
      setPhase(null);
    }
  }, [mode, onAssessed, photo.uri, plantId, uploadedPath]);

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
        {uploadedPath && !busy ? (
          <Text style={styles.note}>Photo already uploaded — retrying skips the upload.</Text>
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
