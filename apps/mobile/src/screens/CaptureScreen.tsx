import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { CaptureHint, RoundButton } from "../components/CaptureOverlay";
import { PlantPickerSheet } from "../components/PlantPickerSheet";
import type { AssessedResult } from "../lib/assess";
import { SNAP_TIPS, preselectedPlantId } from "../lib/capture-modes";
import { loadSnapTipsSeen, markSnapTipsSeen } from "../lib/capture-modes-io";
import { downscalePhoto, type PreparedPhoto } from "../lib/photo-io";
import { type PlantListItem } from "../lib/plants";
import { fetchPlants } from "../lib/plants-io";
import { RADIUS } from "../lib/theme";
import { DiagnosisScreen } from "./DiagnosisScreen";
import { ReviewScreen } from "./ReviewScreen";

// Full-screen capture flow (design doc §3/§6), opened from the tab-bar FAB:
// camera with one neutral guide, gallery import at equal prominence, plant
// target selection, then review (ReviewScreen) → analyze → diagnosis
// (DiagnosisScreen). onAssessed fires as soon as /assess persists a result so
// the Plants tab behind the modal can refresh its scores.
// F21: there is one shutter and no mode selector — the model reports what it
// saw, and a rejected (non-plant) photo never reaches DiagnosisScreen.
// F35: no plant needs to be selected — snap first, and the AI drafts the
// new-plant form from the photo (ReviewScreen owns that deferred flow).

const GENERIC_PHOTO_ERROR = "Couldn't process that photo. Please try again.";
const GENERIC_PLANTS_ERROR = "Could not load your plants. Close and try again.";

interface Props {
  onClose: () => void;
  /** An assessment was saved server-side (before the modal closes). */
  onAssessed?: () => void;
  /** Preselect this plant (detail screen's "Assess this plant"). */
  initialPlantId?: string;
}

export function CaptureScreen({ onClose, onAssessed, initialPlantId }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const askedRef = useRef(false);

  const [plants, setPlants] = useState<PlantListItem[] | null>(null);
  const [plantsError, setPlantsError] = useState(false);
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [result, setResult] = useState<AssessedResult | null>(null);
  /** F35: the plant created by the deferred (snap-first) flow. */
  const [savedPlant, setSavedPlant] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** F36: null until the seen-flag loads; true = the guide is on screen. */
  const [tipsOpen, setTipsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSnapTipsSeen().then((seen) => {
      if (!cancelled && !seen) setTipsOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Request camera permission on open (once); the denied state below offers
  // the settings hint and keeps gallery import available.
  useEffect(() => {
    if (!permission || permission.granted || askedRef.current) return;
    if (permission.canAskAgain) {
      askedRef.current = true;
      requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    let cancelled = false;
    fetchPlants()
      .then((items) => {
        if (cancelled) return;
        setPlants(items);
        // F35: no forced picker — an unselected plant means "new plant".
        setSelectedPlantId(preselectedPlantId(items, initialPlantId));
      })
      .catch(() => {
        // fetchPlants already logged details.
        if (!cancelled) setPlantsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initialPlantId]);

  const selectedPlant = plants?.find((p) => p.id === selectedPlantId) ?? null;
  const ready = !busy;

  const prepare = useCallback(
    async (uri: string, width: number, height: number) => {
      setBusy(true);
      setError(null);
      try {
        setPhoto(await downscalePhoto(uri, { width, height }));
      } catch (e) {
        console.error("[CaptureScreen] downscale failed:", (e as Error).message);
        setError(GENERIC_PHOTO_ERROR);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const takePhoto = useCallback(async () => {
    const camera = cameraRef.current;
    if (!camera) return;
    setBusy(true);
    setError(null);
    try {
      const shot = await camera.takePictureAsync({ quality: 1 });
      if (!shot) throw new Error("no picture returned");
      await prepare(shot.uri, shot.width, shot.height);
    } catch (e) {
      console.error("[CaptureScreen] capture failed:", (e as Error).message);
      setError(GENERIC_PHOTO_ERROR);
      setBusy(false);
    }
  }, [prepare]);

  const pickFromGallery = useCallback(async () => {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      await prepare(asset.uri, asset.width, asset.height);
    } catch (e) {
      console.error("[CaptureScreen] gallery import failed:", (e as Error).message);
      setError("Couldn't open your photos. Please try again.");
    }
  }, [prepare, selectedPlantId]);

  const resultPlant = selectedPlant ?? savedPlant;
  if (result && resultPlant) {
    return (
      <DiagnosisScreen
        diagnosis={result.diagnosis}
        plantId={resultPlant.id}
        plantName={resultPlant.name}
        onDone={onClose}
      />
    );
  }

  if (photo) {
    return (
      <ReviewScreen
        photo={photo}
        plantId={selectedPlant?.id ?? null}
        plantName={selectedPlant?.name ?? null}
        onRetake={() => setPhoto(null)}
        onClose={onClose}
        onAssessed={(r, plant) => {
          setResult(r);
          if (plant) setSavedPlant(plant);
          onAssessed?.();
        }}
      />
    );
  }

  return (
    <View style={styles.root}>
      {permission?.granted ? (
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      ) : (
        <PermissionState
          denied={permission !== null && !permission.granted && !permission.canAskAgain}
          onRequest={requestPermission}
        />
      )}

      <View style={styles.topBar}>
        <RoundButton label="Close" glyph="✕" onPress={onClose} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose plant"
          onPress={() => setPickerOpen(true)}
          disabled={!plants || plants.length === 0}
          style={styles.plantChip}
        >
          <Text style={styles.plantChipText} numberOfLines={1}>
            {selectedPlant ? `🪴 ${selectedPlant.name}` : "New plant ✨ (tap to pick)"}
          </Text>
        </Pressable>
        <RoundButton label="Photo tips" glyph="?" onPress={() => setTipsOpen(true)} />
      </View>

      <View style={styles.bottomArea}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {plantsError ? <Text style={styles.error}>{GENERIC_PLANTS_ERROR}</Text> : null}
        <CaptureHint />
        <View style={styles.controls}>
          <View style={styles.sideControl}>
            <RoundButton
              label="Import from gallery"
              glyph="🖼️"
              size={56}
              disabled={busy}
              onPress={pickFromGallery}
            />
            <Text style={styles.controlCaption}>Gallery</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            disabled={!ready || !permission?.granted}
            onPress={takePhoto}
            style={[
              styles.shutter,
              { opacity: !ready || !permission?.granted ? 0.4 : 1 },
            ]}
          >
            {busy ? <ActivityIndicator color="#111" /> : <View style={styles.shutterInner} />}
          </Pressable>
          <View style={styles.sideControl}>
            {/* Spacer mirroring the gallery button keeps the shutter centered. */}
            <View style={{ width: 56, height: 56 }} />
            <Text style={styles.controlCaption}> </Text>
          </View>
        </View>
      </View>

      {tipsOpen ? (
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
              onPress={() => {
                setTipsOpen(false);
                void markSnapTipsSeen();
              }}
              style={styles.tipsCta}
            >
              <Text style={styles.tipsCtaText}>Got it</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <PlantPickerSheet
        visible={pickerOpen}
        plants={plants ?? []}
        selectedId={selectedPlantId}
        onSelect={(id) => {
          setSelectedPlantId(id);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

function PermissionState({ denied, onRequest }: { denied: boolean; onRequest: () => void }) {
  return (
    <View style={styles.permission}>
      <Text style={styles.permissionTitle}>
        {denied ? "Camera access is off" : "Camera permission needed"}
      </Text>
      <Text style={styles.permissionBody}>
        {denied
          ? "Enable camera access for Citrus Care in your device settings to photograph plants. You can still import a photo from your gallery below."
          : "Citrus Care uses the camera to photograph your plants for health checks."}
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

const styles = StyleSheet.create({
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
    backgroundColor: "#059669",
    borderRadius: RADIUS,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  tipsCtaText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
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
  plantChip: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  plantChipText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  bottomArea: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 42,
    paddingHorizontal: 24,
    gap: 12,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  sideControl: { alignItems: "center", gap: 4 },
  controlCaption: { color: "#ffffff", fontSize: 11, fontWeight: "600" },
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
});
