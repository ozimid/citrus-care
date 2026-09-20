import { CameraView, useCameraPermissions } from "expo-camera";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  CaptureHint,
  PermissionState,
  PlantChip,
  RoundButton,
  SnapTipsOverlay,
  useWalkMode,
  WalkControls,
  WalkModeLine,
} from "../components/CaptureOverlay";
import { ImportSheet, type ImportProgress } from "../components/ImportSheet";
import { PlantPickerSheet } from "../components/PlantPickerSheet";
import { TagScanSheet, useTagScan } from "../components/TagScanSheet";
import type { AssessedResult } from "../lib/assess";
import { preselectedPlantId } from "../lib/capture-modes";
import { loadSnapTipsSeen, markSnapTipsSeen } from "../lib/capture-modes-io";
import { downscalePhoto, type PreparedPhoto } from "../lib/photo-io";
import { MAX_IMPORT, type AssignEvidence, type QueuedPhoto } from "../lib/photo-queue";
import {
  enqueueWalkShot,
  IMPORT_NO_SPACE_ERROR,
  IMPORT_PARTIAL_ERROR,
  importGalleryAssets,
  newWalkId,
} from "../lib/photo-queue-io";
import { type PlantListItem } from "../lib/plants";
import { fetchPlants } from "../lib/plants-io";
import { RADIUS } from "../lib/theme";
import { DiagnosisScreen } from "./DiagnosisScreen";
import { ReviewScreen } from "./ReviewScreen";
import { WalkReviewScreen } from "./WalkReviewScreen";
import { WalkRunScreen } from "./WalkRunScreen";

// Full-screen capture flow (design doc §3/§6), opened from the tab-bar FAB:
// camera with one neutral guide, gallery import at equal prominence, plant
// target selection, then review (ReviewScreen) → analyze → diagnosis
// (DiagnosisScreen). onAssessed fires as soon as /assess persists a result so
// the Plants tab behind the modal can refresh its scores.
// F21: there is one shutter and no mode selector — the model reports what it
// saw, and a rejected (non-plant) photo never reaches DiagnosisScreen.
// F35: no plant needs to be selected — snap first, and the AI drafts the
// new-plant form from the photo (ReviewScreen owns that deferred flow).
// F39: the gallery picks up to MAX_IMPORT photos. One photo is the flow above,
// unchanged; several go into the durable photo queue (D-W2) and open the
// review screen, which asks "Analyze now / Later" every time (D-W7); "Analyze
// now" hands the runnable photos to WalkRunScreen, which runs them one at a
// time (D-W5) and reports once, at the end, how many assessments landed.
// F39 walk mode (D-W7, useWalkMode): a remembered, visibly checked toggle.
// ON, the shutter saves straight to the queue under the sticky chip and the
// viewfinder comes back at once; a chip idle ≥ CARRY_IDLE_MS goes amber and
// its shots carry `carried` evidence (D-W3); "Scan tag" (useTagScan) takes one
// still and decodes it in pure JS (D-W15) — a bound code switches the chip to
// its owner, an unknown one is bound through the picker; Done · N opens the
// review. OFF is today's flow, verbatim.
// Scan-to-bind (`scanTarget`, from a plant's Tags card): the same viewfinder
// with only Scan tag — one successful scan binds and closes.

const GENERIC_PHOTO_ERROR = "Couldn't process that photo. Please try again.";
const GENERIC_PLANTS_ERROR = "Could not load your plants. Close and try again.";
const GENERIC_GALLERY_ERROR = "Couldn't open your photos. Please try again.";
const IMPORT_FAILED_ERROR = "Couldn't import those photos. Please try again.";
const SAVED_LATER_NOTICE = "Saved for later — find it on the Plants tab";
const SCAN_TO_BIND_HINT = "Fill the frame with the code, then tap Scan tag";
/** How long a viewfinder toast stays. */
const SAVED_NOTICE_MS = 1800;
/** "N photos kept" is read, then the capture closes. */
const KEEP_NOTICE_MS = 1400;

interface Props {
  onClose: () => void;
  /** An assessment was saved (before the modal closes). */
  onAssessed?: () => void;
  /** Preselect this plant (detail screen's "Assess this plant"). */
  initialPlantId?: string;
  /** Scan-to-bind from PlantTagsCard: bind the scanned code to this plant. */
  scanTarget?: string;
}

export function CaptureScreen({ onClose, onAssessed, initialPlantId, scanTarget }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const askedRef = useRef(false);
  const bindMode = scanTarget !== undefined;

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
  /** F39: one walk per open capture — every queued photo from this session
   * shares it, so the review and the run see them as one visit (D-W6). */
  const [walkId] = useState(() => newWalkId());
  const [importing, setImporting] = useState<ImportProgress | null>(null);
  /** The import landed; showing the review with its one-line notice. */
  const [walkReview, setWalkReview] = useState<{ notice: string | null } | null>(null);
  /** "Analyze now": the runnable photos plus the plants they name (re-read at
   * the tap — the review may have created one). */
  const [walkRun, setWalkRun] = useState<{ items: QueuedPhoto[]; plants: PlantListItem[] } | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  /** Close with saved walk shots: the "kept" toast is read, then we leave. */
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSnapTipsSeen().then((seen) => {
      if (!cancelled && !seen && !bindMode) setTipsOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [bindMode]);

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

  // Toasts are read on the viewfinder, then fade; the camera stays up.
  useEffect(() => {
    if (!savedNotice) return;
    const timer = setTimeout(() => setSavedNotice(null), SAVED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [savedNotice]);

  const selectedPlant = plants?.find((p) => p.id === selectedPlantId) ?? null;
  const ready = !busy && !closing;
  const havePlants = !!plants && plants.length > 0;

  const walkMode = useWalkMode({ enabled: !bindMode, selectedPlant, walkId, cameraRef, setBusy, setError });
  // D-W7: walk mode is disabled with zero plants. The remembered flag is left
  // as it is; the EFFECTIVE mode is off until there is a plant to save to, so
  // a first-time user always gets the snap-first flow.
  const walk = walkMode.walk && havePlants;
  const { walkCount } = walkMode;

  /** Leave after the walk: the Plants tab refreshes so its pending-walk card
   * is right, then close. */
  const finishWalk = useCallback(() => {
    onAssessed?.();
    onClose();
  }, [onAssessed, onClose]);

  /** Close never discards (D-W2): saved shots stay queued; the user is told
   * where they are, then the capture closes. */
  const close = useCallback(() => {
    if (closing) return finishWalk();
    if (walkCount === 0) return onClose();
    setClosing(true);
    setSavedNotice(`${walkCount} photo${walkCount === 1 ? "" : "s"} kept — find them on the Plants tab`);
    setTimeout(finishWalk, KEEP_NOTICE_MS);
  }, [closing, finishWalk, onClose, walkCount]);

  const startWalkRun = useCallback(async (items: QueuedPhoto[]) => {
    let named: PlantListItem[] = plants ?? [];
    try {
      named = await fetchPlants();
    } catch {
      // fetchPlants already logged; the run names what it can.
    }
    setWalkRun({ items, plants: named });
  }, [plants]);

  /** A hand pick is a confirm: the chip is fresh and no code run is active. */
  const pickPlant = useCallback(
    (id: string) => {
      setSelectedPlantId(id);
      walkMode.setScanDigest(null);
      walkMode.touchActivity();
      setPickerOpen(false);
    },
    [walkMode],
  );

  const tagScan = useTagScan({
    cameraRef,
    plants,
    selectedPlantId,
    scanTarget,
    onSwitch: (plantId, digest) => {
      setSelectedPlantId(plantId);
      walkMode.setScanDigest(digest);
      walkMode.touchActivity();
    },
    onBound: async (plantId, digest) => {
      if (bindMode) {
        onAssessed?.();
        onClose();
        return;
      }
      let named = plants ?? [];
      try {
        named = await fetchPlants();
        setPlants(named);
      } catch {
        // fetchPlants already logged; the chip still switches.
      }
      setSelectedPlantId(plantId);
      walkMode.setScanDigest(digest);
      walkMode.touchActivity();
      setSavedNotice(`Code bound to ${named.find((p) => p.id === plantId)?.name ?? "that plant"}`);
    },
    onTypeInstead: () => setPickerOpen(true),
    notify: setSavedNotice,
    fail: setError,
  });

  /** Downscale into the review photo. True when the copy exists (the caller
   * may then drop its own original); the user sees only the generic error. */
  const prepare = useCallback(
    async (uri: string, width: number, height: number): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        setPhoto(await downscalePhoto(uri, { width, height }));
        return true;
      } catch (e) {
        console.error("[CaptureScreen] downscale failed:", (e as Error).message);
        setError(GENERIC_PHOTO_ERROR);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const takePhoto = useCallback(async () => {
    if (walk) return walkMode.takeWalkShot();
    const camera = cameraRef.current;
    if (!camera) return;
    setBusy(true);
    setError(null);
    try {
      const shot = await camera.takePictureAsync({ quality: 1 });
      if (!shot) throw new Error("no picture returned");
      if (await prepare(shot.uri, shot.width, shot.height)) {
        // The downscaled copy is what the flow uses from here; the full-res
        // original is cache weight nothing reads again. Best-effort.
        try {
          new File(shot.uri).delete();
        } catch (e) {
          console.error("[CaptureScreen] original cleanup failed:", (e as Error).message);
        }
      }
    } catch (e) {
      console.error("[CaptureScreen] capture failed:", (e as Error).message);
      setError(GENERIC_PHOTO_ERROR);
      setBusy(false);
    }
  }, [prepare, walk, walkMode]);

  const pickFromGallery = useCallback(async () => {
    setError(null);
    // Set BEFORE the await: the picker copies every selected original into
    // cache before it returns (seconds for 30), and the user must see why.
    setImporting({ kind: "picking" });
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
        allowsMultipleSelection: true,
        selectionLimit: MAX_IMPORT,
        orderedSelection: true,
        exif: true,
      });
      if (result.canceled || result.assets.length === 0) return;
      if (result.assets.length === 1 && !walk) {
        // One photo: today's single-shot flow, unchanged.
        setImporting(null);
        const asset = result.assets[0];
        await prepare(asset.uri, asset.width, asset.height);
        return;
      }
      // Several (or walk mode): each becomes durable before the next starts
      // (D-W2); the sheet's count is true because of that.
      setImporting({ kind: "importing", done: 0, total: result.assets.length });
      // D-W3: the chip is hard evidence only when it was set for THIS import
      // (this plant's own screen, or the only plant). A chip that merely
      // happened to be set is a guess the review shows as one — twenty photos
      // of a whole garden must never land on one tree without a badge.
      const seedEvidence: AssignEvidence = !selectedPlant
        ? "none"
        : initialPlantId === selectedPlant.id || plants?.length === 1
          ? "user"
          : "carried";
      const { imported, failed } = await importGalleryAssets(
        result.assets,
        { walkId, seedPlantId: selectedPlant?.id ?? null, seedEvidence },
        (done, total) => setImporting({ kind: "importing", done, total }),
      );
      if (imported === 0) {
        setError(IMPORT_FAILED_ERROR);
        return;
      }
      if (walk) {
        // Same walk as the shutter: stay in the viewfinder, count them.
        walkMode.addImported(imported);
        setSavedNotice(imported === 1 ? "1 photo saved to this walk" : `${imported} photos saved to this walk`);
        if (failed > 0) setError(IMPORT_PARTIAL_ERROR(failed));
        return;
      }
      setWalkReview({ notice: failed > 0 ? IMPORT_PARTIAL_ERROR(failed) : null });
    } catch (e) {
      console.error("[CaptureScreen] gallery import failed:", (e as Error).message);
      // The no-space message is written for the user; everything else is generic.
      setError((e as Error).message === IMPORT_NO_SPACE_ERROR ? IMPORT_NO_SPACE_ERROR : GENERIC_GALLERY_ERROR);
    } finally {
      setImporting(null);
    }
  }, [initialPlantId, plants, prepare, selectedPlant, walk, walkId, walkMode]);

  /** F39 "Save for later": the reviewed shot goes to the durable queue under
   * the chosen plant (or none); the Plants tab behind refreshes and the
   * viewfinder comes back for the next tree. */
  const saveForLater = useCallback(async () => {
    if (!photo) return;
    await enqueueWalkShot({
      sourceUri: photo.uri,
      width: photo.width,
      height: photo.height,
      plantId: selectedPlant?.id ?? null,
      evidence: selectedPlant ? "user" : "none",
      walkId,
      source: "camera",
      takenAt: new Date().toISOString(),
    });
    setPhoto(null);
    setSavedNotice(SAVED_LATER_NOTICE);
    onAssessed?.();
  }, [onAssessed, photo, selectedPlant, walkId]);

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

  if (walkRun) {
    return (
      <WalkRunScreen
        items={walkRun.items}
        plants={walkRun.plants}
        // One Plants refresh for the whole run, not one per photo — and always
        // one: even a run with no new assessment changed the queue the
        // pending-walk card counts (rejected / exhausted photos stop waiting).
        onFinished={() => onAssessed?.()}
        onClose={onClose}
      />
    );
  }

  if (walkReview) {
    return (
      <WalkReviewScreen
        walkId={walkId}
        notice={walkReview.notice}
        onAnalyze={(items) => void startWalkRun(items)}
        onLater={finishWalk}
        onClose={finishWalk}
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
        onSaveForLater={saveForLater}
      />
    );
  }

  const cameraOn = permission?.granted === true;
  // A sheet is up (scanning / no code / picker). The walk-mode "Switched to …"
  // toast is not one: the chip already moved and the next shot must be free.
  const scanBusy = tagScan.scan !== null && tagScan.scan.state !== "bound";

  return (
    <View style={styles.root}>
      {cameraOn ? (
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      ) : (
        <PermissionState
          denied={permission !== null && !permission.granted && !permission.canAskAgain}
          onRequest={requestPermission}
        />
      )}

      <View style={styles.topBar}>
        {/* 48 dp: in walk mode Close is the keep-and-leave exit, load-bearing
            for a gloved thumb; held while a walk shot is still being saved
            so the "N photos kept" count is true. */}
        <RoundButton label="Close" glyph="✕" size={48} disabled={walk && busy} onPress={close} />
        {bindMode ? (
          <Text style={styles.bindHeader} accessibilityRole="header">
            Point at the code on this plant
          </Text>
        ) : (
          <PlantChip
            walk={walk}
            plantName={selectedPlant?.name ?? null}
            stale={walkMode.stale}
            disabled={!havePlants}
            onPress={() => setPickerOpen(true)}
          />
        )}
        {bindMode ? (
          <View style={styles.topSpacer} />
        ) : (
          <RoundButton label="Photo tips" glyph="?" size={48} onPress={() => setTipsOpen(true)} />
        )}
      </View>

      <View style={styles.bottomArea}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {plantsError ? <Text style={styles.error}>{GENERIC_PLANTS_ERROR}</Text> : null}
        {savedNotice ? (
          <Text style={styles.toast} accessibilityLiveRegion="polite">
            ✓ {savedNotice}
          </Text>
        ) : null}
        {bindMode ? (
          <CaptureHint text={SCAN_TO_BIND_HINT} />
        ) : walk ? (
          <WalkModeLine />
        ) : (
          <CaptureHint />
        )}
        <WalkControls
          mode={bindMode ? "bind" : walk ? "walk" : "single"}
          busy={busy}
          canShoot={ready && cameraOn && !scanBusy}
          onShutter={() => void takePhoto()}
          galleryLabel={`Import from gallery, up to ${MAX_IMPORT} photos`}
          galleryDisabled={!ready || importing !== null || scanBusy}
          onGallery={() => void pickFromGallery()}
          scanDisabled={!ready || !cameraOn || scanBusy || !havePlants}
          onScan={tagScan.start}
          walkEnabled={havePlants && !closing}
          onToggleWalk={walkMode.toggleWalk}
          doneCount={walkCount}
          onDone={() => setWalkReview({ notice: null })}
          flashUri={walkMode.flashUri}
        />
      </View>

      <SnapTipsOverlay
        visible={tipsOpen}
        onClose={() => {
          setTipsOpen(false);
          void markSnapTipsSeen();
        }}
      />

      <ImportSheet progress={importing} />

      {tagScan.sheetProps ? <TagScanSheet {...tagScan.sheetProps} /> : null}

      <PlantPickerSheet
        visible={pickerOpen}
        plants={plants ?? []}
        selectedId={selectedPlantId}
        onSelect={pickPlant}
        onClose={() => setPickerOpen(false)}
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
  topSpacer: { width: 48, height: 48 },
  bindHeader: {
    flex: 1,
    minHeight: 48,
    textAlignVertical: "center",
    textAlign: "center",
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: RADIUS + 6,
    paddingHorizontal: 14,
    overflow: "hidden",
  },
  bottomArea: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 42,
    paddingHorizontal: 24,
    gap: 12,
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
  toast: {
    color: "#ffffff",
    backgroundColor: "rgba(5,150,105,0.92)",
    borderRadius: RADIUS,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    alignSelf: "center",
    overflow: "hidden",
  },
});
