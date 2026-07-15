import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { GuideOverlay, ModeHint, ModePill, RoundButton } from "../components/CaptureOverlay";
import { PlantPickerSheet } from "../components/PlantPickerSheet";
import type { AssessResult } from "../lib/assess";
import {
  DEFAULT_CAPTURE_MODE,
  preselectedPlantId,
  type CaptureModeKey,
} from "../lib/capture-modes";
import { downscalePhoto, type PreparedPhoto } from "../lib/photo-io";
import { fetchPlants, type PlantListItem } from "../lib/plants";
import { supabase } from "../lib/supabase";
import { RADIUS } from "../lib/theme";
import { DiagnosisScreen } from "./DiagnosisScreen";
import { ReviewScreen } from "./ReviewScreen";

// Full-screen capture flow (design doc §3/§6), opened from the tab-bar FAB:
// camera with the three-mode guide, gallery import at equal prominence, plant
// target selection, then review (ReviewScreen) → analyze → diagnosis
// (DiagnosisScreen). onAssessed fires as soon as /assess persists a result so
// the Plants tab behind the modal can refresh its scores.

const GENERIC_PHOTO_ERROR = "Couldn't process that photo. Please try again.";
const GENERIC_PLANTS_ERROR = "Could not load your plants. Close and try again.";

interface Props {
  onClose: () => void;
  /** An assessment was saved server-side (before the modal closes). */
  onAssessed?: () => void;
}

export function CaptureScreen({ onClose, onAssessed }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const askedRef = useRef(false);

  const [plants, setPlants] = useState<PlantListItem[] | null>(null);
  const [plantsError, setPlantsError] = useState(false);
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<CaptureModeKey>(DEFAULT_CAPTURE_MODE);
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [result, setResult] = useState<AssessResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    fetchPlants(supabase)
      .then((items) => {
        if (cancelled) return;
        setPlants(items);
        const preselected = preselectedPlantId(items);
        setSelectedPlantId(preselected);
        // More than one plant: the FAB needs a target, so ask right away.
        if (!preselected && items.length > 1) setPickerOpen(true);
      })
      .catch(() => {
        // fetchPlants already logged details.
        if (!cancelled) setPlantsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPlant = plants?.find((p) => p.id === selectedPlantId) ?? null;
  const ready = selectedPlantId !== null && !busy;

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
    // Gallery import doesn't need the camera, but a photo still needs a plant
    // to belong to — so if none is chosen yet, open the picker instead of a
    // silent no-op.
    if (selectedPlantId === null) {
      setPickerOpen(true);
      return;
    }
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

  if (result && selectedPlant) {
    return (
      <DiagnosisScreen
        diagnosis={result.diagnosis}
        plantId={selectedPlant.id}
        plantName={selectedPlant.name}
        mode={mode}
        onDone={onClose}
      />
    );
  }

  if (photo && selectedPlant) {
    return (
      <ReviewScreen
        photo={photo}
        plantId={selectedPlant.id}
        plantName={selectedPlant.name}
        mode={mode}
        onRetake={() => setPhoto(null)}
        onClose={onClose}
        onAssessed={(r) => {
          setResult(r);
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

      {permission?.granted ? <GuideOverlay mode={mode} /> : null}

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
            {selectedPlant ? `🪴 ${selectedPlant.name}` : "Choose plant ▾"}
          </Text>
        </Pressable>
        <View style={styles.topSpacer} />
      </View>

      <View style={styles.bottomArea}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {plantsError ? <Text style={styles.error}>{GENERIC_PLANTS_ERROR}</Text> : null}
        {plants && plants.length === 0 ? (
          <Text style={styles.error}>Add a plant first — the photo needs a plant to belong to.</Text>
        ) : null}
        <ModeHint mode={mode} />
        <ModePill mode={mode} onSelect={setMode} />
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
  topSpacer: { width: 40 },
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
