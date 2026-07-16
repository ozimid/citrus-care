// D-15 Stage 1 spike (hidden, entered from Profile → Developer): measure
// whether Gemma 4 E2B via react-native-executorch's multimodal useLLM clears
// the go/no-go bar in docs/research/on-device-vlm-native.md. Pure measurement
// instrumentation — NOT the production engine router; assess.ts is untouched.
// This module imports react-native-executorch, whose import installs the
// native runtime (dev-build only), so ProfileScreen loads it lazily — the rest
// of the app must keep working where the native module is absent (Expo Go).

import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { initExecutorch, useLLM } from "react-native-executorch";
import { ExpoResourceFetcher } from "react-native-executorch-expo-resource-fetcher";
import { LOCAL_MODEL } from "../components/LocalEngineSession";
import { SPIKE_MAX_DIMENSION } from "../lib/photo";
import { downscalePhoto, type PreparedPhoto } from "../lib/photo-io";
import {
  appendRun,
  classifyInit,
  formatMs,
  parseTally,
  runPassesBar,
  type InitKind,
  type SpikeRun,
} from "../lib/spike-metrics";
import { loadRunLog, saveRunLog } from "../lib/spike-metrics-io";
import {
  SPIKE_SYSTEM_PROMPT,
  SPIKE_USER_PROMPT,
  parseDiagnosisOutput,
  type DiagnosisParseResult,
} from "../lib/spike-vlm";
import { RADIUS, type Tokens } from "../lib/theme";
import { useTheme } from "../lib/theme-io";

initExecutorch({ resourceFetcher: ExpoResourceFetcher });

const MODEL_LOAD_ERROR =
  "The model couldn't be downloaded or initialized. Check your connection and free storage, then try again.";
const INFERENCE_ERROR =
  "The on-device analysis failed — the model may have run out of memory. Try again, or restart the app.";
const PHOTO_PICK_ERROR = "Couldn't open your photos. Please try again.";

interface InitMeasurement {
  kind: InitKind;
  totalMs: number;
  /** Time spent downloading (cold init only, when the fetcher reported progress). */
  downloadMs: number | null;
}

interface LastInference {
  text: string;
  ms: number;
  parsed: DiagnosisParseResult;
}

export function VlmSpikeScreen({ onClose }: { onClose: () => void }) {
  const { t } = useTheme();
  const [runs, setRuns] = useState<SpikeRun[]>([]);
  const [started, setStarted] = useState(false);
  // Remount key for the session: bumping it re-runs useLLM's load, which is
  // how warm init is measured (and how a failed load is retried).
  const [session, setSession] = useState(0);

  useEffect(() => {
    loadRunLog()
      .then(setRuns)
      .catch((e) => console.error("[VlmSpikeScreen] run log load failed:", (e as Error).message));
  }, []);

  const recordRun = useCallback((run: SpikeRun) => {
    setRuns((prev) => {
      const next = appendRun(prev, run);
      saveRunLog(next).catch((e) =>
        console.error("[VlmSpikeScreen] run log save failed:", (e as Error).message),
      );
      return next;
    });
  }, []);

  const tally = parseTally(runs);

  return (
    <View style={[styles.root, { backgroundColor: t.canvas }]}>
      <View style={styles.header}>
        <Text style={[styles.heading, { color: t.text }]}>On-device model spike</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close spike screen" onPress={onClose} hitSlop={8}>
          <Text style={[styles.close, { color: t.green }]}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {!started ? (
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[styles.label, { color: t.sub }]}>Gemma 4 E2B · react-native-executorch</Text>
            <Text style={[styles.body, { color: t.text }]}>
              First use downloads the model — about 1.3 GB. Use WiFi; it is cached on this phone
              afterwards. Nothing leaves the device.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setStarted(true)}
              style={[styles.primary, { backgroundColor: t.green }]}
            >
              <Text style={[styles.primaryText, { color: t.onGreen }]}>Download & initialize</Text>
            </Pressable>
          </View>
        ) : (
          <SpikeSession key={session} t={t} onRecord={recordRun} onReinit={() => setSession((s) => s + 1)} />
        )}

        {runs.length > 0 && (
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[styles.label, { color: t.sub }]}>
              Run history · schema parse {tally.passed}/{tally.total} ({tally.verdict}, bar: ≥3 of 5)
            </Text>
            {runs.map((r, i) => (
              <View key={`${r.at}-${i}`} style={styles.row}>
                <Text style={[styles.rowText, { color: t.text }]} numberOfLines={1}>
                  {r.kind === "inference" ? "Inference" : r.kind === "init-cold" ? "Init (cold)" : "Init (warm)"}
                  {" · "}
                  {formatMs(r.ms)}
                  {r.kind === "inference" ? ` · parse ${r.parseOk ? "ok" : "failed"}` : ""}
                </Text>
                <Text style={[styles.rowBadge, { color: runPassesBar(r) ? t.green : t.danger }]}>
                  {runPassesBar(r) ? "PASS" : "FAIL"}
                </Text>
              </View>
            ))}
          </View>
        )}
        <Text style={[styles.foot, { color: t.sub }]}>
          Bar: cold init ≤ 90 s · warm init ≤ 10 s · inference ≤ 15 s · input {SPIKE_MAX_DIMENSION}px long edge.
        </Text>
      </ScrollView>
    </View>
  );
}

function SpikeSession({
  t,
  onRecord,
  onReinit,
}: {
  t: Tokens;
  onRecord: (run: SpikeRun) => void;
  onReinit: () => void;
}) {
  const llm = useLLM({ model: LOCAL_MODEL });
  const loadStartRef = useRef(Date.now());
  const sawDownloadRef = useRef(false);
  const downloadDoneAtRef = useRef<number | null>(null);
  const [init, setInit] = useState<InitMeasurement | null>(null);
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<LastInference | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);

  useEffect(() => {
    const p = llm.downloadProgress;
    if (p > 0 && p < 1) sawDownloadRef.current = true;
    if (p >= 1 && downloadDoneAtRef.current === null) downloadDoneAtRef.current = Date.now();
  }, [llm.downloadProgress]);

  useEffect(() => {
    if (!llm.isReady || init !== null) return;
    const kind = classifyInit(sawDownloadRef.current);
    const totalMs = Date.now() - loadStartRef.current;
    const downloadMs =
      kind === "cold" && downloadDoneAtRef.current !== null
        ? downloadDoneAtRef.current - loadStartRef.current
        : null;
    setInit({ kind, totalMs, downloadMs });
    onRecord({
      at: new Date().toISOString(),
      kind: kind === "cold" ? "init-cold" : "init-warm",
      ms: totalMs,
    });
  }, [llm.isReady, init, onRecord]);

  useEffect(() => {
    if (llm.error) console.error("[VlmSpikeScreen] model load failed:", String(llm.error));
  }, [llm.error]);

  const pickPhoto = useCallback(async () => {
    setUiError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      // Input discipline: 512px long edge — full-res balloons on-device
      // latency to minutes (research doc), so never feed the 1600px image.
      setPhoto(
        await downscalePhoto(asset.uri, { width: asset.width, height: asset.height }, SPIKE_MAX_DIMENSION),
      );
    } catch (e) {
      console.error("[VlmSpikeScreen] photo pick failed:", (e as Error).message);
      setUiError(PHOTO_PICK_ERROR);
    }
  }, []);

  const runInference = useCallback(async () => {
    if (!photo || !llm.isReady || running) return;
    setUiError(null);
    setRunning(true);
    const t0 = Date.now();
    try {
      // generate() over sendMessage(): stateless per run, so timings aren't
      // skewed by an ever-growing conversation context.
      const text = await llm.generate([
        { role: "system", content: SPIKE_SYSTEM_PROMPT },
        { role: "user", content: SPIKE_USER_PROMPT, mediaPath: photo.uri },
      ]);
      const ms = Date.now() - t0;
      const parsed = parseDiagnosisOutput(text);
      setLast({ text, ms, parsed });
      onRecord({ at: new Date().toISOString(), kind: "inference", ms, parseOk: parsed.ok });
    } catch (e) {
      console.error("[VlmSpikeScreen] inference failed:", (e as Error).message);
      setUiError(INFERENCE_ERROR);
    } finally {
      setRunning(false);
    }
  }, [photo, llm, running, onRecord]);

  if (llm.error) {
    return (
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.body, { color: t.danger }]}>{MODEL_LOAD_ERROR}</Text>
        <Pressable accessibilityRole="button" onPress={onReinit} style={[styles.primary, { backgroundColor: t.green }]}>
          <Text style={[styles.primaryText, { color: t.onGreen }]}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!llm.isReady) {
    const downloading = llm.downloadProgress > 0 && llm.downloadProgress < 1;
    return (
      <View style={[styles.card, styles.center, { backgroundColor: t.card, borderColor: t.border }]}>
        <ActivityIndicator color={t.green} />
        <Text style={[styles.body, { color: t.text }]}>
          {downloading
            ? `Downloading model… ${Math.round(llm.downloadProgress * 100)}%`
            : "Initializing session…"}
        </Text>
      </View>
    );
  }

  return (
    <>
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.label, { color: t.sub }]}>Session</Text>
        {init && (
          <>
            <MetricRow t={t} name={`Init (${init.kind})`} value={formatMs(init.totalMs)} pass={runPassesBar({ kind: init.kind === "cold" ? "init-cold" : "init-warm", ms: init.totalMs })} />
            {init.downloadMs !== null && (
              <MetricRow t={t} name="— of which download" value={formatMs(init.downloadMs)} />
            )}
          </>
        )}
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={pickPhoto} style={[styles.secondary, { borderColor: t.green }]}>
            <Text style={[styles.secondaryText, { color: t.green }]}>{photo ? "Pick another photo" : "Pick a photo"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onReinit} style={[styles.secondary, { borderColor: t.border }]}>
            <Text style={[styles.secondaryText, { color: t.sub }]}>Re-init (warm)</Text>
          </Pressable>
        </View>
        {photo && (
          <View style={styles.photoRow}>
            <Image source={{ uri: photo.uri }} style={[styles.thumb, { borderColor: t.border }]} />
            <Text style={[styles.body, styles.flex, { color: t.sub }]}>
              {photo.width}×{photo.height} JPEG, on-device only
            </Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={!photo || running}
          onPress={runInference}
          style={[styles.primary, { backgroundColor: t.green, opacity: !photo || running ? 0.5 : 1 }]}
        >
          {running ? (
            <ActivityIndicator color={t.onGreen} />
          ) : (
            <Text style={[styles.primaryText, { color: t.onGreen }]}>Run diagnosis</Text>
          )}
        </Pressable>
        {uiError && <Text style={[styles.body, { color: t.danger }]}>{uiError}</Text>}
      </View>

      {last && (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[styles.label, { color: t.sub }]}>Last run</Text>
          <MetricRow t={t} name="Inference" value={formatMs(last.ms)} pass={runPassesBar({ kind: "inference", ms: last.ms })} />
          <MetricRow
            t={t}
            name="Schema parse"
            value={last.parsed.ok ? `ok · score ${last.parsed.diagnosis.health_score}` : last.parsed.reason}
            pass={last.parsed.ok}
          />
          <ScrollView style={[styles.output, { borderColor: t.border }]} nestedScrollEnabled>
            <Text selectable style={[styles.outputText, { color: t.text }]}>
              {last.text || "(empty output)"}
            </Text>
          </ScrollView>
        </View>
      )}
    </>
  );
}

function MetricRow({ t, name, value, pass }: { t: Tokens; name: string; value: string; pass?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowText, { color: t.sub }]}>{name}</Text>
      <Text style={[styles.rowText, { color: t.text }]}>
        {value}
        {pass !== undefined && (
          <Text style={{ color: pass ? t.green : t.danger }}>{pass ? "  PASS" : "  FAIL"}</Text>
        )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 68 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  heading: { fontSize: 24, fontWeight: "600", letterSpacing: -0.4 },
  close: { fontSize: 15, fontWeight: "600" },
  scroll: { paddingHorizontal: 20, paddingBottom: 32, gap: 14 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    padding: 16,
    gap: 10,
  },
  center: { alignItems: "center" },
  label: { fontSize: 12 },
  body: { fontSize: 14, lineHeight: 20 },
  primary: {
    borderRadius: RADIUS,
    paddingVertical: 13,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  primaryText: { fontSize: 15, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 10 },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingVertical: 10,
    alignItems: "center",
  },
  secondaryText: { fontSize: 13, fontWeight: "600" },
  photoRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: 64, height: 64, borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth },
  flex: { flexShrink: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 2,
  },
  rowText: { fontSize: 13, fontWeight: "500", flexShrink: 1 },
  rowBadge: { fontSize: 12, fontWeight: "700" },
  output: { maxHeight: 220, borderWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS, padding: 10 },
  outputText: { fontSize: 12, fontFamily: "monospace", lineHeight: 17 },
  foot: { fontSize: 12, textAlign: "center" },
});
