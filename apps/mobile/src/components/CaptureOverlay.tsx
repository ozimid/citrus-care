import type { CameraView } from "expo-camera";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { CAPTURE_HINT, SNAP_TIPS } from "../lib/capture-modes";
import { loadWalkMode, saveWalkMode } from "../lib/capture-modes-io";
import { CARRY_IDLE_MS, type AssignEvidence } from "../lib/photo-queue";
import { enqueueWalkShot, queuedPhotoUri, WALK_SAVE_ERROR } from "../lib/photo-queue-io";
import type { PlantListItem } from "../lib/plants";
import { RADIUS } from "../lib/theme";

// Viewfinder chrome for the capture screen. F21 deleted the segmented mode
// pill and the three per-mode guide shapes: the user should not have to tell a
// vision model what it is looking at. F35 removed the framing rectangle too
// (it read as a crop preview and nothing is cropped); one honest hint remains.
// keep the "get closer" nudge without asking for a classification. Purely
// presentational — the hint string lives in src/lib/capture-modes.ts (tested).
// The permission state and the F36 tips guide live here too, so the
// viewfinder file stays readable as walk mode lands.
// F39 (D-W7): the walk-mode chrome — the checked Walk toggle, the mode line,
// the two-line sticky chip, Scan tag, Done · N — is here as well, with the
// small state machine behind it (useWalkMode: the remembered toggle, the
// count, the idle clock behind `carried`, the shutter-to-queue shot), so the
// screen stays a viewfinder that composes flows.

const GENERIC_PHOTO_ERROR = "Couldn't process that photo. Please try again.";
/** The thumbnail flash after a walk shot. */
const FLASH_MS = 900;

const WALK_GREEN = "#059669";
const STALE_AMBER = "rgba(180,83,9,0.82)";

/** One honest hint under the viewfinder; `text` overrides it (scan-to-bind). */
export function CaptureHint({ text = CAPTURE_HINT }: { text?: string }) {
  return (
    <View style={styles.hintWrap}>
      <Text style={styles.hint}>{text}</Text>
    </View>
  );
}

/** D-W7: replaces CaptureHint while walk mode is on — the shutter no longer
 * analyzes, and that has to be readable in sunlight. The plant's name is the
 * chip's job (larger, tappable); this line only says what the shutter does. */
export function WalkModeLine() {
  return (
    <View style={[styles.hintWrap, styles.walkLine]} accessibilityLiveRegion="polite">
      <Text style={styles.hint}>Walk mode · the shutter saves without analyzing — tap Done to review</Text>
    </View>
  );
}

/** Translucent round chrome button (close/retake/gallery) shared by the
 * capture and review screens. `checked` turns it into a toggle: green fill,
 * white glyph, announced as checked. */
export function RoundButton({
  label,
  glyph,
  onPress,
  size = 40,
  disabled = false,
  checked,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  size?: number;
  disabled?: boolean;
  checked?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={checked === undefined ? "button" : "togglebutton"}
      accessibilityLabel={label}
      accessibilityState={{ disabled, ...(checked === undefined ? {} : { checked }) }}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.roundButton,
        checked ? styles.roundButtonChecked : null,
        { width: size, height: size, borderRadius: size / 2, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <Text style={[styles.roundButtonGlyph, { fontSize: size >= 56 ? 22 : 16 }]}>{glyph}</Text>
    </Pressable>
  );
}

/** The top-bar plant chip. Walk off: today's one-liner. Walk on: sticky,
 * two-line, ≥ 48 dp, and amber with "still on …" once the chip has gone
 * CARRY_IDLE_MS without a confirm or a fresh shot (D-W3 `carried`); only a
 * confirm clears the amber. */
export function PlantChip({
  walk,
  plantName,
  stale,
  disabled,
  onPress,
}: {
  walk: boolean;
  plantName: string | null;
  stale: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  if (!walk) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose plant"
        onPress={onPress}
        disabled={disabled}
        style={styles.plantChip}
      >
        <Text style={styles.plantChipText} numberOfLines={1}>
          {plantName ? `🪴 ${plantName}` : "New plant ✨ (tap to pick)"}
        </Text>
      </Pressable>
    );
  }
  const main = plantName ? (stale ? `still on 🪴 ${plantName}` : `🪴 ${plantName}`) : "🪴 No plant yet";
  const sub = plantName
    ? stale
      ? "tap to confirm or change"
      : "tap to change"
    : "tap to pick — photos are kept unassigned";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        plantName
          ? stale
            ? `Still on ${plantName}. Tap to confirm or change plant`
            : `Saving to ${plantName}. Tap to change plant`
          : "No plant yet. Tap to pick a plant"
      }
      accessibilityLiveRegion={stale ? "polite" : "none"}
      onPress={onPress}
      disabled={disabled}
      style={[styles.plantChip, styles.plantChipWalk, stale ? styles.plantChipStale : null]}
    >
      <Text style={styles.plantChipText} numberOfLines={1}>
        {main}
      </Text>
      <Text style={styles.plantChipSub} numberOfLines={1}>
        {sub}
      </Text>
    </Pressable>
  );
}

/** The bottom control block for all three viewfinder modes.
 *  - single (walk off): Gallery · shutter · Walk toggle — today's row, with
 *    the toggle where the empty spacer was.
 *  - walk: the same row with the toggle checked, plus a row above it: the
 *    thumbnail flash of the last saved shot, Scan tag straight above the
 *    shutter, and the Done · N pill (≥ 48 dp, bottom-right).
 *  - bind (scan-to-bind from a Tags card): Scan tag alone, large; no shutter,
 *    no gallery, no toggle. */
export function WalkControls({
  mode,
  busy,
  canShoot,
  onShutter,
  galleryLabel,
  galleryDisabled,
  onGallery,
  scanDisabled,
  onScan,
  walkEnabled,
  onToggleWalk,
  doneCount,
  onDone,
  flashUri,
}: {
  mode: "single" | "walk" | "bind";
  busy: boolean;
  canShoot: boolean;
  onShutter: () => void;
  galleryLabel: string;
  galleryDisabled: boolean;
  onGallery: () => void;
  scanDisabled: boolean;
  onScan: () => void;
  walkEnabled: boolean;
  onToggleWalk: () => void;
  doneCount: number;
  onDone: () => void;
  flashUri: string | null;
}) {
  if (mode === "bind") {
    return (
      <View style={styles.controls}>
        <View style={styles.sideControl} />
        <View style={styles.sideControl}>
          <RoundButton label="Scan tag" glyph="▣" size={76} disabled={scanDisabled} onPress={onScan} />
          <Text style={styles.controlCaption}>Scan tag</Text>
        </View>
        <View style={styles.sideControl} />
      </View>
    );
  }
  const walk = mode === "walk";
  const photos = doneCount === 1 ? "1 photo" : `${doneCount} photos`;
  return (
    <View style={styles.controlBlock}>
      {walk ? (
        <View style={styles.walkRow}>
          <View style={styles.sideControl}>
            {flashUri ? (
              <Image
                source={{ uri: flashUri }}
                style={styles.flash}
                accessibilityIgnoresInvertColors
                accessible
                accessibilityLabel="Saved"
              />
            ) : (
              <View style={styles.flashSpacer} />
            )}
          </View>
          <View style={styles.sideControl}>
            <RoundButton label="Scan tag" glyph="▣" size={56} disabled={scanDisabled} onPress={onScan} />
            <Text style={styles.controlCaption}>Scan tag</Text>
          </View>
          <View style={styles.sideControl}>
            {doneCount > 0 ? (
              // A walk spans plants, so the count is not attributed to the
              // chip's plant. Disabled while a shot is still being saved: the
              // review it opens must include the last photo.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Done. ${photos} saved on this walk. Review and analyze`}
                accessibilityState={{ disabled: busy }}
                accessibilityLiveRegion="polite"
                disabled={busy}
                onPress={onDone}
                style={[styles.donePill, { opacity: busy ? 0.5 : 1 }]}
              >
                <Text style={styles.donePillText}>Done · {doneCount}</Text>
              </Pressable>
            ) : (
              <View style={styles.flashSpacer} />
            )}
          </View>
        </View>
      ) : null}
      <View style={styles.controls}>
        <View style={styles.sideControl}>
          <RoundButton label={galleryLabel} glyph="🖼️" size={56} disabled={galleryDisabled} onPress={onGallery} />
          <Text style={styles.controlCaption}>Gallery</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={walk ? "Take photo and save it to this walk" : "Take photo"}
          disabled={!canShoot}
          onPress={onShutter}
          style={[styles.shutter, { opacity: canShoot ? 1 : 0.4 }]}
        >
          {busy ? <View style={styles.shutterBusy} /> : <View style={styles.shutterInner} />}
        </Pressable>
        <View style={styles.sideControl}>
          <RoundButton
            label={walk ? "Walk mode on. Tap to turn off" : "Walk mode off. Tap to turn on"}
            glyph="🚶"
            size={56}
            checked={walk}
            disabled={!walkEnabled}
            onPress={onToggleWalk}
          />
          <Text style={styles.controlCaption}>{walk ? "Walk on" : "Walk"}</Text>
        </View>
      </View>
    </View>
  );
}

/** Walk mode's state (D-W7 / D-W3). `enabled` is false in scan-to-bind mode,
 * where the remembered flag must not switch anything on. */
export function useWalkMode({
  enabled,
  selectedPlant,
  walkId,
  cameraRef,
  setBusy,
  setError,
}: {
  enabled: boolean;
  selectedPlant: PlantListItem | null;
  walkId: string;
  cameraRef: RefObject<CameraView | null>;
  setBusy: (busy: boolean) => void;
  setError: (text: string | null) => void;
}) {
  const [walk, setWalk] = useState(false);
  const [walkCount, setWalkCount] = useState(0);
  const [stale, setStale] = useState(false);
  const [flashUri, setFlashUri] = useState<string | null>(null);
  /** Last confirm, or last shot taken while the chip was fresh (ms) — the
   * idle clock behind `carried` (D-W3). A shot on a stale chip does NOT reset
   * it: the chip stays amber until the user confirms, so a burst on an
   * unconfirmed tree reads as one guess, not one guess and two certainties. */
  const activityRef = useRef(Date.now());
  const [activityTick, setActivityTick] = useState(0);
  /** The code run the chip is on: set by a bound scan, cleared by a hand
   * pick or an idle gap, so `code-scan` evidence never outlives either. */
  const scanDigestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadWalkMode().then((on) => {
      if (!cancelled) setWalk(on);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // The chip goes stale CARRY_IDLE_MS after the last shot or confirm.
  useEffect(() => {
    if (!walk) return;
    const remaining = activityRef.current + CARRY_IDLE_MS - Date.now();
    if (remaining <= 0) {
      setStale(true);
      return;
    }
    const timer = setTimeout(() => setStale(true), remaining);
    return () => clearTimeout(timer);
  }, [walk, activityTick]);

  useEffect(() => {
    if (!flashUri) return;
    const timer = setTimeout(() => setFlashUri(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashUri]);

  const touchActivity = useCallback(() => {
    activityRef.current = Date.now();
    setStale(false);
    setActivityTick((n) => n + 1);
  }, []);

  const toggleWalk = useCallback(() => {
    const next = !walk;
    setWalk(next);
    if (next) touchActivity();
    void saveWalkMode(next);
  }, [touchActivity, walk]);

  const setScanDigest = useCallback((digest: string | null) => {
    scanDigestRef.current = digest;
  }, []);

  /** Gallery photos imported into this walk count like shots. */
  const addImported = useCallback(
    (n: number) => {
      setWalkCount((c) => c + n);
      touchActivity();
    },
    [touchActivity],
  );

  /** Walk mode shutter: straight into the durable queue under the chip, then
   * back to the viewfinder. Evidence per D-W3: a stale chip → `carried`, a
   * scanned code run → `code-scan` (the digest rides the record so the review
   * can tell which scan bound the photo), a confirmed chip → `user`. */
  const takeWalkShot = useCallback(async () => {
    const camera = cameraRef.current;
    if (!camera) return;
    setBusy(true);
    setError(null);
    try {
      const shot = await camera.takePictureAsync({ quality: 1 });
      if (!shot) throw new Error("no picture returned");
      const now = Date.now();
      const idle = now - activityRef.current >= CARRY_IDLE_MS;
      const evidence: AssignEvidence = !selectedPlant
        ? "none"
        : idle
          ? "carried"
          : scanDigestRef.current
            ? "code-scan"
            : "user";
      const item = await enqueueWalkShot({
        sourceUri: shot.uri,
        width: shot.width,
        height: shot.height,
        plantId: selectedPlant?.id ?? null,
        evidence,
        codeDigest: evidence === "code-scan" ? scanDigestRef.current : null,
        walkId,
        source: "camera",
        takenAt: new Date(now).toISOString(),
      });
      // An idle gap ends the scanned run: the next tree is not "scanned". The
      // chip stays stale until a confirm (pick / switch / bind), never a shot.
      if (idle) scanDigestRef.current = null;
      else touchActivity();
      setWalkCount((n) => n + 1);
      setFlashUri(queuedPhotoUri(item));
    } catch (e) {
      console.error("[CaptureScreen] walk shot failed:", (e as Error).message);
      setError((e as Error).message === WALK_SAVE_ERROR ? WALK_SAVE_ERROR : GENERIC_PHOTO_ERROR);
    } finally {
      setBusy(false);
    }
  }, [cameraRef, selectedPlant, setBusy, setError, touchActivity, walkId]);

  return {
    walk,
    walkCount,
    /** Amber "still on …" only when there is a plant to still be on. */
    stale: stale && selectedPlant !== null,
    flashUri,
    toggleWalk,
    touchActivity,
    setScanDigest,
    addImported,
    takeWalkShot,
  };
}

/** Camera permission not granted: ask (first time) or point at the device
 * settings (denied for good). Gallery import stays available beneath it. */
export function PermissionState({ denied, onRequest }: { denied: boolean; onRequest: () => void }) {
  return (
    <View style={styles.permission}>
      <Text style={styles.permissionTitle}>
        {denied ? "Camera access is off" : "Camera permission needed"}
      </Text>
      <Text style={styles.permissionBody}>
        {denied
          ? "Enable camera access for Citrus Care in your device settings to photograph plants. You can still import a photo from your gallery below."
          : "Citrus Care uses the camera to photograph your plants for health checks and to read the tag codes on your plants."}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={denied ? () => Linking.openSettings() : onRequest}
        style={styles.permissionButton}
      >
        <Text style={styles.permissionButtonText}>
          {denied ? "Open settings" : "Allow camera"}
        </Text>
      </Pressable>
    </View>
  );
}

/** F36 — the "getting a good photo" guide: shown once on first open, and on
 * demand from the ? button. The tips themselves are pure (capture-modes.ts). */
export function SnapTipsOverlay({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  if (!visible) return null;
  return (
    <View style={styles.tipsOverlay}>
      <View style={styles.tipsCard}>
        <Text style={styles.tipsTitle}>Getting a good photo</Text>
        {SNAP_TIPS.map((tip) => (
          <View key={tip.title} style={styles.tipRow}>
            <Text style={styles.tipGlyph}>{tip.glyph}</Text>
            <View style={styles.tipTextWrap}>
              <Text style={styles.tipTitle}>{tip.title}</Text>
              <Text style={styles.tipBody}>{tip.body}</Text>
            </View>
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close photo tips"
          onPress={onClose}
          style={styles.tipsCta}
        >
          <Text style={styles.tipsCtaText}>Got it</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Deliberately shape-neutral: a soft rectangle suits a leaf, a whole tree
   * and a sawn branch end equally, which is the point. */
  hintWrap: {
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: 320,
  },
  hint: { color: "#ffffff", fontSize: 13, fontWeight: "500", textAlign: "center" },
  walkLine: { backgroundColor: "rgba(5,150,105,0.85)", borderRadius: RADIUS, maxWidth: 360 },
  roundButton: {
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  roundButtonChecked: { backgroundColor: WALK_GREEN },
  roundButtonGlyph: { color: "#ffffff", fontWeight: "600" },
  plantChip: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  plantChipWalk: { minHeight: 48, justifyContent: "center", borderRadius: RADIUS + 6, paddingVertical: 6 },
  plantChipStale: { backgroundColor: STALE_AMBER },
  plantChipText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  plantChipSub: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "500", marginTop: 1 },
  controlBlock: { gap: 10 },
  walkRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  /** Both sides flex equally so a longer caption never shifts the shutter. */
  sideControl: { flex: 1, alignItems: "center", gap: 4 },
  controlCaption: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.75)",
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 1 },
  },
  flash: { width: 56, height: 56, borderRadius: RADIUS, borderWidth: 2, borderColor: "#ffffff" },
  flashSpacer: { width: 56, height: 56 },
  donePill: {
    minHeight: 48,
    minWidth: 96,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: WALK_GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  donePillText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 5,
    borderColor: "rgba(255,255,255,0.7)",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#d4d4d4",
  },
  shutterBusy: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#d4d4d4",
  },
  permission: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 10,
  },
  permissionTitle: { color: "#ffffff", fontSize: 17, fontWeight: "600" },
  permissionBody: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 300,
  },
  permissionButton: {
    marginTop: 8,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: RADIUS,
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  permissionButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  tipsOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    padding: 24,
  },
  tipsCard: {
    backgroundColor: "rgba(20,24,20,0.97)",
    borderRadius: RADIUS * 1.5,
    padding: 20,
    gap: 16,
  },
  tipsTitle: { color: "#ffffff", fontSize: 18, fontWeight: "700" },
  tipRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  tipGlyph: { fontSize: 22 },
  tipTextWrap: { flex: 1, gap: 2 },
  tipTitle: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  tipBody: { color: "rgba(255,255,255,0.75)", fontSize: 13, lineHeight: 19 },
  tipsCta: {
    marginTop: 4,
    backgroundColor: WALK_GREEN,
    borderRadius: RADIUS,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  tipsCtaText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
});
