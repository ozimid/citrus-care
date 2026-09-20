// F39 "Scan tag" (D-W3 rung 2, D-W13, D-W15): what the user sees after the
// one deliberate still is decoded, and the small state machine behind it
// (useTagScan), kept beside the sheet so CaptureScreen stays a viewfinder.
//
// The payload is never here. captureAndDecode returns it raw, interpretScan
// digests it in the same tick and only the digest and its 4-hex `display`
// survive; nothing is stored, opened, parsed or shown in full. A bound code
// seen while another plant is selected SWITCHES the chip to its owner — the
// viewfinder never offers to move a code (rebinding lives in PlantTagsCard).
// Only an explicit "Not now" silences a code for the session; Cancel, the
// backdrop and hardware back just close the sheet, and "Aim again" returns to
// the live viewfinder — the still is already taken, so re-shooting from under
// a card would photograph wherever the phone happens to point.

import type { CameraView } from "expo-camera";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { codeDisplay, interpretScan, type ScanInterpretation } from "../lib/plant-tags";
import { bindPlantCode, PLANT_CODE_LIMIT_ERROR } from "../lib/plant-store-io";
import type { PlantListItem } from "../lib/plants";
import { captureAndDecode } from "../lib/qr-decode-io";
import { RADIUS } from "../lib/theme";
import { useTheme } from "../lib/theme-io";
import { PlantPickerSheet } from "./PlantPickerSheet";

export type TagScanState = "scanning" | "no-code" | "bound" | "ambiguous" | "unknown";

export interface TagScanSheetProps {
  state: TagScanState;
  /** bound: the plant the chip switched to (walk) / the current owner (bind). */
  plantName?: string;
  /** unknown / ambiguous: codeDisplay(digest) — the only form a code is shown in. */
  display?: string;
  /** unknown: every plant to pick from; ambiguous: the code's owners. */
  candidates?: PlantListItem[];
  /** Preselected row in the hosted picker (the current chip). */
  selectedId?: string | null;
  /** Scan-to-bind from a Tags card: no picker, and "bound" means the code is
   * already on some plant. */
  mode?: "walk" | "bind";
  onBind: (plantId: string) => void;
  /** Explicit: skip this code for the rest of the capture session. */
  onNotNow: () => void;
  /** Cancel / backdrop / hardware back: just close, nothing remembered. */
  onCancel: () => void;
  /** Back to the live viewfinder so the user can re-aim before the next still. */
  onRetry: () => void;
  onTypeInstead: () => void;
}

const BIND_ERROR = "Couldn't bind that code. Please try again.";
const SKIPPED_NOTICE = "Code skipped for now — pick the plant instead";
/** How long the "Switched to …" toast stays on the viewfinder. */
const BOUND_TOAST_MS = 2200;

export function TagScanSheet({
  state,
  plantName,
  display,
  candidates = [],
  selectedId = null,
  mode = "walk",
  onBind,
  onNotNow,
  onCancel,
  onRetry,
  onTypeInstead,
}: TagScanSheetProps) {
  const { t } = useTheme();

  if (state === "unknown" || state === "ambiguous") {
    const unknown = state === "unknown";
    return (
      <PlantPickerSheet
        visible
        title={unknown ? "Which plant has this code?" : "Which of these is it?"}
        plants={candidates}
        selectedId={selectedId}
        onSelect={onBind}
        onClose={onCancel}
        footer={
          <View style={styles.pickerFootWrap}>
            {/* Binding is a durable routing decision: the consequence sits
                next to the tap that takes it (the fingerprint note lives on
                the Tags card, where the code is managed). */}
            <Text style={[styles.pickerFoot, { color: t.sub }]}>
              {unknown
                ? `Tapping a plant binds ${display ?? "this code"} to it. Scanning it will pick that plant from now on — remove it later on that plant's Tag & codes card.`
                : `${display ?? "This code"} is on more than one plant — fix that on a plant's Tag & codes card.`}
            </Text>
            <Pressable accessibilityRole="button" onPress={onNotNow} style={styles.tertiary}>
              <Text style={[styles.secondaryText, { color: t.sub }]}>Not now — skip this code on this walk</Text>
            </Pressable>
          </View>
        }
      />
    );
  }

  if (state === "bound" && mode === "walk") {
    // Zero extra taps: the chip already switched; this just says so.
    return (
      <View style={styles.toastWrap} pointerEvents="none">
        <Text style={styles.toast} accessibilityLiveRegion="polite">
          ✓ Switched to {plantName ?? "that plant"} · scanned
        </Text>
      </View>
    );
  }

  const scanning = state === "scanning";
  // The still is already taken: what follows is a file read and a few decode
  // passes on this phone, so the copy asks for nothing and back can cancel.
  const title = scanning
    ? "Reading the code…"
    : state === "bound"
      ? `This code is already on ${plantName ?? "another plant"}`
      : "No code found";
  const body = scanning
    ? "Reading it on this phone — a few seconds."
    : state === "bound"
      ? "Move it from that plant's Tags card if it belongs here."
      : mode === "bind"
        ? "Try closer — a code about 4 cm wide reads best from around 40 cm."
        : "Pick the plant or try closer — a code about 4 cm wide reads best from around 40 cm.";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View
          style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}
          accessibilityLiveRegion="polite"
        >
          {scanning ? <ActivityIndicator color={t.green} size="large" /> : null}
          <Text style={[styles.title, { color: t.text }]}>{title}</Text>
          <Text style={[styles.body, { color: t.sub }]}>{body}</Text>
          {scanning ? null : (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={onRetry}
                style={[styles.primary, { backgroundColor: t.green }]}
              >
                <Text style={[styles.primaryText, { color: t.onGreen }]}>
                  {state === "bound" ? "Scan another" : "Aim again"}
                </Text>
              </Pressable>
              {mode === "walk" && state === "no-code" ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={onTypeInstead}
                  style={[styles.secondary, { borderColor: t.border }]}
                >
                  <Text style={[styles.secondaryText, { color: t.text }]}>Type the number</Text>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" onPress={onNotNow} style={styles.tertiary}>
                <Text style={[styles.secondaryText, { color: t.sub }]}>Not now</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The state machine.

interface ScanView {
  state: TagScanState;
  digest: string | null;
  plantName?: string;
  candidates?: PlantListItem[];
}

interface UseTagScanArgs {
  cameraRef: RefObject<CameraView | null>;
  plants: PlantListItem[] | null;
  selectedPlantId: string | null;
  /** Scan-to-bind: bind straight to this plant, then the caller closes. */
  scanTarget?: string;
  /** Walk: the chip switches. `digest` is the code run the chip is now on,
   * null when the user picked by hand (ambiguous → not deciding evidence). */
  onSwitch: (plantId: string, digest: string | null) => void;
  /** A code was bound (or, in bind mode, is already on the target). The
   * caller re-reads its plants and, in bind mode, closes. */
  onBound: (plantId: string, digest: string) => Promise<void> | void;
  onTypeInstead: () => void;
  /** Viewfinder toast (live region). */
  notify: (text: string) => void;
  /** Viewfinder error line — generic, or one of the user-written messages. */
  fail: (text: string) => void;
}

export function useTagScan(args: UseTagScanArgs): {
  scan: ScanView | null;
  start: () => void;
  sheetProps: TagScanSheetProps | null;
} {
  const [scan, setScan] = useState<ScanView | null>(null);
  // interpretScan's repeat window and the session "Not now" memory.
  const lastRef = useRef<{ digest: string | null; atMs: number }>({ digest: null, atMs: 0 });
  const dismissedRef = useRef(new Set<string>());
  // A result that lands after a newer scan started (or after unmount) is dropped.
  const seqRef = useRef(0);
  const argsRef = useRef(args);
  argsRef.current = args;

  useEffect(
    () => () => {
      seqRef.current += 1;
    },
    [],
  );

  const bind = useCallback(async (plantId: string, digest: string) => {
    try {
      await bindPlantCode(plantId, digest);
    } catch (e) {
      const message = (e as Error).message;
      console.error("[TagScan] bind failed:", message);
      argsRef.current.fail(message === PLANT_CODE_LIMIT_ERROR ? message : BIND_ERROR);
      setScan(null);
      return;
    }
    setScan(null);
    await argsRef.current.onBound(plantId, digest);
  }, []);

  const showBound = useCallback((digest: string, plantName: string) => {
    const seq = seqRef.current;
    setScan({ state: "bound", digest, plantName });
    setTimeout(() => {
      if (seq === seqRef.current) setScan((s) => (s?.state === "bound" ? null : s));
    }, BOUND_TOAST_MS);
  }, []);

  const handle = useCallback(
    async (result: ScanInterpretation, plants: PlantListItem[]) => {
      const { scanTarget, onSwitch, notify } = argsRef.current;
      const nameOf = (id: string) => plants.find((p) => p.id === id)?.name ?? "that plant";
      switch (result.kind) {
        case "ignored":
          if (result.reason === "invalid") setScan({ state: "no-code", digest: null });
          else {
            setScan(null);
            if (result.reason === "dismissed") notify(SKIPPED_NOTICE);
          }
          return;
        case "bound":
          if (scanTarget !== undefined) {
            if (result.plantId === scanTarget) await bind(scanTarget, result.digest);
            else setScan({ state: "bound", digest: result.digest, plantName: nameOf(result.plantId) });
            return;
          }
          // D-W3: the owner decides — the chip switches, never a Move prompt.
          onSwitch(result.plantId, result.digest);
          showBound(result.digest, nameOf(result.plantId));
          return;
        case "ambiguous":
          if (scanTarget !== undefined) {
            if (result.plantIds.includes(scanTarget)) await bind(scanTarget, result.digest);
            else
              setScan({
                state: "bound",
                digest: result.digest,
                plantName: result.plantIds.map(nameOf).join(" and "),
              });
            return;
          }
          setScan({
            state: "ambiguous",
            digest: result.digest,
            candidates: plants.filter((p) => result.plantIds.includes(p.id)),
          });
          return;
        case "unknown":
          if (scanTarget !== undefined) {
            await bind(scanTarget, result.digest);
            return;
          }
          setScan({ state: "unknown", digest: result.digest, candidates: plants });
          return;
      }
    },
    [bind, showBound],
  );

  const start = useCallback(() => {
    const camera = argsRef.current.cameraRef.current;
    const plants = argsRef.current.plants;
    if (!camera || !plants || plants.length === 0) return;
    const seq = ++seqRef.current;
    setScan({ state: "scanning", digest: null });
    void (async () => {
      let payload: string | null = null;
      try {
        payload = await captureAndDecode(camera);
      } catch (e) {
        // Never the payload — only the runtime's reason.
        console.error("[TagScan] capture/decode failed:", (e as Error).message);
      }
      if (seq !== seqRef.current) return;
      const nowMs = Date.now();
      const result = interpretScan(plants, payload, {
        lastDigest: lastRef.current.digest,
        lastAtMs: lastRef.current.atMs,
        nowMs,
        dismissed: dismissedRef.current,
      });
      payload = null;
      if (result.kind !== "ignored") lastRef.current = { digest: result.digest, atMs: nowMs };
      await handle(result, plants);
    })();
  }, [handle]);

  /** Close the sheet and drop any decode still in flight (a late result must
   * never pop a sheet after the user left). */
  const dismissSheet = useCallback(() => {
    seqRef.current += 1;
    setScan(null);
  }, []);

  const sheetProps: TagScanSheetProps | null = scan
    ? {
        state: scan.state,
        plantName: scan.plantName,
        display: scan.digest ? codeDisplay(scan.digest) : undefined,
        candidates: scan.candidates,
        selectedId: args.selectedPlantId,
        mode: args.scanTarget !== undefined ? "bind" : "walk",
        onBind: (plantId) => {
          if (scan.state === "unknown" && scan.digest) {
            void bind(plantId, scan.digest);
          } else if (scan.state === "ambiguous") {
            // Two owners: the user's pick is a hand pick, not code evidence.
            setScan(null);
            args.onSwitch(plantId, null);
            args.notify(`Switched to ${args.plants?.find((p) => p.id === plantId)?.name ?? "that plant"}`);
          }
        },
        onNotNow: () => {
          if (scan.digest) dismissedRef.current.add(scan.digest);
          dismissSheet();
        },
        onCancel: dismissSheet,
        // Back to the live viewfinder; the Scan tag button takes the next
        // still once the user has actually re-aimed.
        onRetry: dismissSheet,
        onTypeInstead: () => {
          dismissSheet();
          args.onTypeInstead();
        },
      }
    : null;

  return { scan, start, sheetProps };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    padding: 28,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS + 4,
    padding: 22,
    alignItems: "center",
    gap: 10,
  },
  title: { fontSize: 17, fontWeight: "600", textAlign: "center" },
  body: { fontSize: 13, lineHeight: 18, textAlign: "center" },
  actions: { alignSelf: "stretch", gap: 8, marginTop: 6 },
  primary: { minHeight: 48, borderRadius: RADIUS, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 15, fontWeight: "600" },
  secondary: {
    minHeight: 48,
    borderRadius: RADIUS,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontSize: 15, fontWeight: "600" },
  tertiary: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  pickerFootWrap: { paddingTop: 8, gap: 2 },
  pickerFoot: { fontSize: 12, lineHeight: 17, textAlign: "center" },
  toastWrap: { position: "absolute", left: 24, right: 24, bottom: 200, alignItems: "center" },
  toast: {
    color: "#ffffff",
    backgroundColor: "rgba(5,150,105,0.92)",
    borderRadius: RADIUS,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    overflow: "hidden",
  },
});
