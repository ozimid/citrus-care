// F39 Phase 0 device probe — throwaway, dev-only, mounted from the spike
// screen (Profile → Developer). Answers, on a real phone, what the design doc
// §"Phase 0 device probe" needs recorded before Phase 1: what the multi-select
// picker hands back (dims, EXIF date keys, GPS presence, latency); whether
// pure-JS jpeg-js → jsqr decodes a sticker at 800 px and how fast; whether
// keep-awake holds through sequential inference (the PRODUCTION engine, under
// the shared budget via runDiagnoseOnly). Logs EXIF key NAMES only. Delete
// this file once the results are in docs/design/garden-walk.md.

import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { decode as decodeJpeg } from "jpeg-js";
import jsQR from "jsqr";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { friendlyAssessError, runDiagnoseOnly } from "../lib/assess";
import { base64ToBytes } from "../lib/backup";
import { useKeepAwakeWhile } from "../lib/keep-awake-io";
import { downscalePhoto, type PreparedPhoto } from "../lib/photo-io";
import { RADIUS, type Tokens } from "../lib/theme";
import { buildAssessDeps } from "./assess-deps";
import { useLocalEngine } from "./LocalEngineProvider";

export function GardenWalkProbe({ t }: { t: Tokens }) {
  const localEngine = useLocalEngine();
  const [log, setLog] = useState<string[]>([]);
  const [picked, setPicked] = useState<PreparedPhoto[]>([]);
  const [running, setRunning] = useState(false);
  const say = useCallback((line: string) => setLog((prev) => [...prev, line].slice(-40)), []);
  // The same hook production uses, so the probe measures what a walk will get.
  useKeepAwakeWhile(running, "probe");

  const pickFive = useCallback(async () => {
    const t0 = Date.now();
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
        allowsMultipleSelection: true,
        selectionLimit: 5,
        exif: true,
      });
      const ms = Date.now() - t0;
      if (res.canceled) return say(`picker: cancelled after ${ms} ms`);
      say(`picker: ${res.assets.length} asset(s) in ${ms} ms`);
      res.assets.forEach((a, i) => {
        const keys = Object.keys(a.exif ?? {});
        const gps = keys.filter((k) => k.startsWith("GPS"));
        const has = (k: string) => (keys.includes(k) ? "yes" : "no");
        say(
          `#${i + 1} ${a.width}×${a.height} ${a.fileName ?? "(no name)"} · DateTimeOriginal ${has("DateTimeOriginal")} · OffsetTimeOriginal ${has("OffsetTimeOriginal")} · GPS keys: ${gps.length ? gps.join(",") : "none"} · ${keys.length} exif keys`,
        );
      });
      setPicked(res.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height })));
    } catch (e) {
      console.error("[probe] pick failed:", (e as Error).message);
      say("picker: failed (see console)");
    }
  }, [say]);

  const decodeQr = useCallback(async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
      const a = res.assets?.[0];
      if (res.canceled || !a) return;
      const small = await downscalePhoto(a.uri, { width: a.width, height: a.height }, 800);
      const t0 = Date.now();
      const bytes = base64ToBytes(await new File(small.uri).base64());
      const t1 = Date.now();
      const img = decodeJpeg(bytes, { useTArray: true });
      const t2 = Date.now();
      const rgba = new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength);
      const code = jsQR(rgba, img.width, img.height);
      const t3 = Date.now();
      say(
        `qr: ${img.width}×${img.height} · read ${t1 - t0} ms · jpeg ${t2 - t1} ms · jsqr ${t3 - t2} ms · ${code ? `HIT, ${code.data.length} chars` : "no code"}`,
      );
    } catch (e) {
      console.error("[probe] qr failed:", (e as Error).message);
      say("qr: failed (see console)");
    }
  }, [say]);

  const keepAwakeAssess = useCallback(async () => {
    const last = picked[picked.length - 1];
    if (!last) return say("assess: pick photos first");
    setRunning(true);
    try {
      for (let i = 1; i <= 3; i++) {
        const t0 = Date.now();
        try {
          const r = await runDiagnoseOnly(buildAssessDeps(localEngine, last, ""), {
            photoUri: last.uri,
            force: true,
          });
          say(`assess ${i}/3: ${r.status} in ${Date.now() - t0} ms`);
        } catch (e) {
          say(`assess ${i}/3: failed after ${Date.now() - t0} ms — ${friendlyAssessError(e)}`);
        }
      }
    } finally {
      setRunning(false);
    }
  }, [localEngine, picked, say]);

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.label, { color: t.sub }]}>Garden Walk probe (F39 Phase 0)</Text>
      <View style={styles.actions}>
        <ProbeButton t={t} label="Pick 5 photos" onPress={pickFive} disabled={running} />
        <ProbeButton t={t} label="Decode QR test shot" onPress={decodeQr} disabled={running} />
      </View>
      <ProbeButton
        t={t}
        label={running ? "Running…" : "Keep-awake 3× assess"}
        onPress={keepAwakeAssess}
        disabled={running || picked.length === 0}
      />
      {log.length > 0 && (
        <ScrollView style={[styles.output, { borderColor: t.border }]} nestedScrollEnabled>
          <Text selectable style={[styles.outputText, { color: t.text }]}>{log.join("\n")}</Text>
        </ScrollView>
      )}
    </View>
  );
}

function ProbeButton({ t, label, onPress, disabled }: { t: Tokens; label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.secondary, { borderColor: t.green, opacity: disabled ? 0.5 : 1 }]}>
      <Text style={[styles.secondaryText, { color: t.green }]}>{label}</Text>
    </Pressable>
  );
}

// Same look as the spike screen's cards, so the probe reads as one of them.
const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    padding: 16,
    gap: 10,
  },
  label: { fontSize: 12 },
  actions: { flexDirection: "row", gap: 10 },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingVertical: 10,
    alignItems: "center",
  },
  secondaryText: { fontSize: 13, fontWeight: "600" },
  output: { maxHeight: 220, borderWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS, padding: 10 },
  outputText: { fontSize: 12, fontFamily: "monospace", lineHeight: 17 },
});
