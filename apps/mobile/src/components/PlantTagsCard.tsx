// F39 Phase 3 — how one plant is identified on a walk (D-W4): the human
// number on the stake (co-primary), the bound codes (SHA-256 digests of any
// pre-printed QR sticker, or of a code the app generated for the user to write
// or print elsewhere), a photo of the installed tag (Houston's 3,000-tree
// protocol), a "Tag missing" flag for a tag the squirrels took, and the five
// sourced tagging rules from docs/research/plant-tagging-garden-walk.md §5.
//
// This card is the ONLY place a code is moved between plants: a bound code
// seen in the viewfinder switches the chip to its owner, never asks (D-W3).
// A raw payload is never on screen — rows show codeDisplay(digest), and a
// generated code is shown exactly once, before it is saved. The card owns its
// own modals (scan-to-bind capture, the move picker, the photo viewer) and
// reports every change upward through onChanged, like PlantToolsCard.

import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { bandColor } from "../lib/health";
import { isSafeBasename } from "../lib/local-id";
import { formFromPlant, validateNewPlant } from "../lib/new-plant";
import { downscalePhoto } from "../lib/photo-io";
import { photoFileName } from "../lib/photo-store";
import { moveIntoPhotoDir, plantPhotoDir } from "../lib/photo-store-io";
import { allPlants, type StoredPlant } from "../lib/plant-store";
import {
  bindPlantCode,
  loadPlantStore,
  movePlantCode,
  setPlantTag,
  setPlantTagMissing,
  setPlantTagPhoto,
  unbindPlantCode,
} from "../lib/plant-store-io";
import {
  codeDigest,
  codeDisplay,
  codeOwners,
  generatePlantCode,
  MAX_CODES_PER_PLANT,
  normalizeCode,
  normalizeTag,
  suggestNextTag,
  TAG_MAX_LENGTH,
} from "../lib/plant-tags";
import type { PlantListItem } from "../lib/plants";
import { fetchPlants } from "../lib/plants-io";
import { RADIUS, type Tokens } from "../lib/theme";
import { CaptureScreen } from "../screens/CaptureScreen";
import { PhotoViewer } from "./PhotoViewer";
import { PlantPickerSheet } from "./PlantPickerSheet";

const TAG_SAVE_ERROR = "Couldn't save the number. Please try again.";
const CODE_SAVE_ERROR = "Couldn't save the code. Please try again.";
const CODE_REMOVE_ERROR = "Couldn't remove the code. Please try again.";
const CODE_MOVE_ERROR = "Couldn't move the code. Please try again.";
const PHOTO_SAVE_ERROR = "Couldn't save that photo. Please try again.";
const PHOTO_REMOVE_ERROR = "Couldn't remove the photo. Please try again.";
const FLAG_SAVE_ERROR = "Couldn't update the tag status. Please try again.";
const PLANTS_LOAD_ERROR = "Could not load your plants. Please try again.";
/** A tag close-up needs no more than the scan copy does (D-W15: 800 px). */
const TAG_PHOTO_MAX_DIMENSION = 800;
const NOTICE_MS = 4000;

/** Research §5, one sourced sentence per rule — lifted as-is, five lines. */
const TAGGING_RULES: ReadonlyArray<string> = [
  "Numbered aluminium tags ($22–26 per 100) outlast everything: plastic cracks and stickers fade in 3–5 years (Bartlett, National Band).",
  "Stickers do not stick to bark — put a QR sticker on a stake or a smooth aluminium blank (Paladin ID).",
  "Hang a tag on a loose loop of coated wire, never zip ties or tight wire, and loosen it as the trunk grows (Bartlett).",
  "Codes of 40 mm or more scan while you stand; a 15 mm sticker means a crouch at every tree (vendor 10:1 rule).",
  "Remove nursery stakes, ties and tags after planting — they girdle the trunk (UC ANR).",
];

/** What the card reads: the identifier fields plus what formFromPlant needs
 * for the shared tag validator. PlantDetailRow satisfies it, so the detail
 * screen hands over the row it already loaded — no second store read. */
export interface TagsCardPlant {
  id: string;
  name: string;
  plant_type: string;
  species: string | null;
  cultivar: string | null;
  location: string | null;
  zip_code: string | null;
  tag?: string | null;
  codes?: string[] | null;
  tag_photo?: string | null;
  tag_missing?: boolean;
}

interface Props {
  plant: TagsCardPlant;
  t: Tokens;
  scheme: "light" | "dark";
  /** The plant record changed — the detail screen reloads and hands back a
   * fresh `plant`. */
  onChanged: () => void;
}

export function PlantTagsCard({ plant, t, scheme, onChanged }: Props) {
  const amber = bandColor("fair", scheme);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Every plant on the phone — taken numbers, the next free one, code owners. */
  const [garden, setGarden] = useState<StoredPlant[]>([]);
  const [editingTag, setEditingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  /** The generated code, shown once; null once saved or discarded. */
  const [generated, setGenerated] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  /** The digest being moved and the other plants to move it to. */
  const [moving, setMoving] = useState<{ digest: string; plants: PlantListItem[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<{ uri: string; caption?: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const codes = plant.codes ?? [];
  const atCodeCap = codes.length >= MAX_CODES_PER_PLANT;
  /** Nothing identifies this plant yet — the one moment the guidance is the
   * point of the card rather than a footnote to it. */
  const untagged = !plant.tag && !plant.tag_photo && codes.length === 0;
  const [rulesOpen, setRulesOpen] = useState<boolean | null>(null);
  const rulesExpanded = rulesOpen ?? untagged;

  useEffect(() => {
    let cancelled = false;
    loadPlantStore()
      .then((store) => {
        if (!cancelled) setGarden(allPlants(store));
      })
      .catch((e) => console.error("[PlantTagsCard] store read failed:", (e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [plant]);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const announce = useCallback((text: string) => {
    setError(null);
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const fail = useCallback((message: string, tag: string, e: unknown) => {
    console.error(`[PlantTagsCard] ${tag} failed:`, (e as Error).message);
    setNotice(null);
    setError(message);
  }, []);

  /** The tag photo's on-phone uri, or null when the record names a file this
   * phone does not have (a restored backup carries the basename only). */
  const tagPhotoUri = useMemo(() => {
    if (!isSafeBasename(plant.tag_photo)) return null;
    try {
      const file = new File(plantPhotoDir(plant.id), plant.tag_photo);
      return file.exists ? file.uri : null;
    } catch (e) {
      console.error("[PlantTagsCard] tag photo path rejected:", (e as Error).message);
      return null;
    }
  }, [plant.id, plant.tag_photo]);

  const nextFree = useMemo(() => suggestNextTag(garden), [garden]);

  // ---- Number on the stake -------------------------------------------------

  const startTagEdit = () => {
    setTagDraft(plant.tag ?? "");
    setTagError(null);
    setEditingTag(true);
  };

  const saveTag = async () => {
    const taken = garden
      .filter((p) => p.id !== plant.id && typeof p.tag === "string" && p.tag.length > 0)
      .map((p) => p.tag as string);
    // Same validator as the new/edit sheet, so the conflict copy is one string.
    const result = validateNewPlant({ ...formFromPlant(plant), tag: tagDraft }, taken);
    if (!result.ok) {
      setTagError(result.errors.tag ?? "Check the number and try again.");
      return;
    }
    setBusy(true);
    try {
      const tag = normalizeTag(tagDraft);
      await setPlantTag(plant.id, tag);
      setEditingTag(false);
      announce(tag ? `Number saved: ${tag}` : "Number cleared");
      onChanged();
    } catch (e) {
      fail(TAG_SAVE_ERROR, "tag save", e);
    } finally {
      setBusy(false);
    }
  };

  const toggleMissing = async (missing: boolean) => {
    try {
      await setPlantTagMissing(plant.id, missing);
      announce(missing ? "Marked as tag missing" : "Tag marked as back on the tree");
      onChanged();
    } catch (e) {
      fail(FLAG_SAVE_ERROR, "tag-missing save", e);
    }
  };

  // ---- Codes -----------------------------------------------------------------

  const confirmRemoveCode = (digest: string) => {
    Alert.alert(
      "Remove this code?",
      "Scanning it will no longer point at this plant. You can bind it again from the viewfinder.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await unbindPlantCode(plant.id, digest);
              announce("Code removed");
              onChanged();
            } catch (e) {
              fail(CODE_REMOVE_ERROR, "code remove", e);
            }
          },
        },
      ],
    );
  };

  const openMove = async (digest: string) => {
    try {
      const plants = (await fetchPlants()).filter((p) => p.id !== plant.id);
      setMoving({ digest, plants });
    } catch (e) {
      fail(PLANTS_LOAD_ERROR, "plants load", e);
    }
  };

  const moveTo = async (toId: string) => {
    if (!moving) return;
    const target = moving.plants.find((p) => p.id === toId);
    setMoving(null);
    // The destination's cap, checked here so the refusal names the plant.
    if ((garden.find((p) => p.id === toId)?.codes?.length ?? 0) >= MAX_CODES_PER_PLANT) {
      setNotice(null);
      setError(`${target?.name ?? "That plant"} already has ${MAX_CODES_PER_PLANT} codes — remove one there first.`);
      return;
    }
    try {
      await movePlantCode(plant.id, toId, moving.digest);
      announce(`Code moved to ${target?.name ?? "the other plant"}`);
      onChanged();
    } catch (e) {
      fail(CODE_MOVE_ERROR, "code move", e);
    }
  };

  const generate = () => {
    // A fresh code must not already name a plant; the odds are ~1 in 10⁹, the
    // check is free.
    let code = generatePlantCode(Math.random);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const normalized = normalizeCode(code);
      if (normalized && codeOwners(garden, codeDigest(normalized)).length === 0) break;
      code = generatePlantCode(Math.random);
    }
    setError(null);
    setGenerated(code);
  };

  const saveGenerated = async () => {
    if (!generated) return;
    const normalized = normalizeCode(generated);
    if (!normalized) {
      fail(CODE_SAVE_ERROR, "generated code normalize", new Error("generated code did not normalize"));
      return;
    }
    setBusy(true);
    try {
      await bindPlantCode(plant.id, codeDigest(normalized));
      setGenerated(null);
      announce("Code saved — scanning it now opens this plant");
      onChanged();
    } catch (e) {
      fail(CODE_SAVE_ERROR, "generated code bind", e);
    } finally {
      setBusy(false);
    }
  };

  const closeScan = () => {
    setScanning(false);
    onChanged();
  };

  // ---- Photo of the tag ------------------------------------------------------

  const deleteTagFile = (basename: string | null | undefined) => {
    if (!isSafeBasename(basename)) return;
    try {
      const file = new File(plantPhotoDir(plant.id), basename);
      if (file.exists) file.delete();
    } catch (e) {
      // Best-effort: an orphaned thumbnail is not worth a user-facing error.
      console.error("[PlantTagsCard] old tag photo delete failed:", (e as Error).message);
    }
  };

  const addPhoto = async (source: "camera" | "gallery") => {
    setBusy(true);
    setError(null);
    try {
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const prepared = await downscalePhoto(
        asset.uri,
        { width: asset.width, height: asset.height },
        TAG_PHOTO_MAX_DIMENSION,
      );
      // Durable first (same-volume move into the plant directory), then the
      // record; the previous photo goes only once the new one is recorded.
      const basename = photoFileName(Date.now(), Math.random());
      await moveIntoPhotoDir(plant.id, prepared.uri, basename);
      const previous = plant.tag_photo;
      try {
        await setPlantTagPhoto(plant.id, basename);
      } catch (e) {
        // The file is in the plant directory but nothing names it; plant-dir
        // orphans are not swept yet, so take it back out.
        deleteTagFile(basename);
        throw e;
      }
      if (previous !== basename) deleteTagFile(previous);
      announce("Tag photo saved");
      onChanged();
    } catch (e) {
      fail(PHOTO_SAVE_ERROR, "tag photo save", e);
    } finally {
      setBusy(false);
    }
  };

  const confirmRemovePhoto = () => {
    Alert.alert("Remove the tag photo?", "It is deleted from this phone. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            const previous = plant.tag_photo;
            await setPlantTagPhoto(plant.id, null);
            deleteTagFile(previous);
            announce("Tag photo removed");
            onChanged();
          } catch (e) {
            fail(PHOTO_REMOVE_ERROR, "tag photo remove", e);
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.cardLabel, { color: t.sub }]}>TAG & CODES</Text>
      <Text style={[styles.cardIntro, { color: t.sub }]}>
        How a walk photo finds this plant: the number on its stake, or a code you scan.
      </Text>
      {notice ? (
        <Text style={[styles.notice, { color: t.green }]} accessibilityLiveRegion="polite">
          ✓ {notice}
        </Text>
      ) : null}
      {error ? (
        <Text style={[styles.notice, { color: t.danger }]} accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}

      {/* ---- Number on the stake ---- */}
      <Text style={[styles.sectionTitle, { color: t.text }]}>Number on the stake</Text>
      {editingTag ? (
        <View style={styles.tagEdit}>
          <TextInput
            accessibilityLabel="Number or tag on the stake"
            value={tagDraft}
            onChangeText={(v) => {
              setTagDraft(v);
              setTagError(null);
            }}
            maxLength={TAG_MAX_LENGTH}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            placeholder="e.g. 7 or L3 — what's written on the stake"
            placeholderTextColor={t.sub}
            style={[
              styles.input,
              { borderColor: tagError ? t.danger : t.border, color: t.text, backgroundColor: t.canvas },
            ]}
          />
          {tagError ? (
            <Text style={[styles.fieldError, { color: t.danger }]} accessibilityLiveRegion="assertive">
              {tagError}
            </Text>
          ) : nextFree ? (
            <Text style={[styles.hint, { color: t.sub }]}>
              Next free number: {nextFree} · leave empty to clear
            </Text>
          ) : null}
          <View style={styles.actions}>
            <ActionButton label="Save number" text="Save" tone="primary" disabled={busy} onPress={saveTag} t={t} />
            <ActionButton label="Cancel editing the number" text="Cancel" onPress={() => setEditingTag(false)} t={t} />
          </View>
        </View>
      ) : (
        <View style={styles.tagRow}>
          <Text
            style={[styles.tagValue, { color: plant.tag ? t.text : t.sub }]}
            accessibilityLabel={plant.tag ? `Number ${plant.tag}` : "No number yet"}
          >
            {plant.tag ? `#${plant.tag}` : "No number yet"}
          </Text>
          <ActionButton
            label={plant.tag ? "Change the number" : "Add a number"}
            text={plant.tag ? "Change" : "Add"}
            // The number comes first (research §2–§4): for an untagged plant
            // this is the one loud button on the card.
            tone={plant.tag ? "neutral" : "primary"}
            onPress={startTagEdit}
            t={t}
          />
        </View>
      )}
      {/* "Tag missing" is a claim about a physical tag — offered only once
          something (a number, a tag photo, a code) says one existed. */}
      {!untagged ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Tag missing"
          accessibilityState={{ checked: plant.tag_missing === true }}
          onPress={() => void toggleMissing(!plant.tag_missing)}
          style={[styles.switchRow, { borderColor: t.border }]}
        >
          <View style={styles.switchText}>
            <Text style={[styles.switchLabel, { color: t.text }]}>Tag missing?</Text>
            <Text style={[styles.switchState, { color: plant.tag_missing ? amber : t.sub }]}>
              {plant.tag_missing ? "⚠ Missing — re-tag this tree" : "On the tree"}
            </Text>
          </View>
          <Switch
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            value={plant.tag_missing === true}
            onValueChange={(on) => void toggleMissing(on)}
            trackColor={{ true: amber }}
          />
        </Pressable>
      ) : null}

      {/* ---- Codes ---- */}
      <Text style={[styles.sectionTitle, { color: t.text }]}>Codes</Text>
      {codes.length === 0 ? (
        <Text style={[styles.hint, { color: t.sub }]}>
          No codes yet. Scan the QR sticker on this plant, or generate a code to write on its tag.
        </Text>
      ) : (
        codes.map((digest) => (
          <View key={digest} style={[styles.codeRow, { borderColor: t.border }]}>
            <Text style={[styles.codeText, { color: t.text }]} accessibilityLabel={`Code ${codeDisplay(digest)}`}>
              {codeDisplay(digest)}
            </Text>
            <ActionButton label={`Move code ${codeDisplay(digest)} to another plant`} text="Move…" onPress={() => void openMove(digest)} t={t} />
            <ActionButton label={`Remove code ${codeDisplay(digest)}`} text="Remove" tone="danger" onPress={() => confirmRemoveCode(digest)} t={t} />
          </View>
        ))
      )}
      {generated ? (
        <View style={[styles.generated, { borderColor: t.green, backgroundColor: t.canvas }]}>
          <Text style={[styles.generatedLabel, { color: t.sub }]}>YOUR NEW CODE</Text>
          <Text
            style={[styles.generatedCode, { color: t.text }]}
            accessibilityLiveRegion="polite"
            accessibilityLabel={`Code ${generated.split("").join(" ")}`}
            selectable
          >
            {generated}
          </Text>
          <Text style={[styles.hint, { color: t.text }]}>
            Make a QR code of this text elsewhere and stick it on the stake; scanning it opens this plant.
            (Writing it by hand won't scan — use the Number field for that.) It is saved when you tap Done and
            shown only now.
          </Text>
          <View style={styles.actions}>
            <ActionButton label="Done — save this code" text="Done" tone="primary" disabled={busy} onPress={saveGenerated} t={t} />
            <ActionButton label="Discard this code" text="Cancel" disabled={busy} onPress={() => setGenerated(null)} t={t} />
          </View>
        </View>
      ) : (
        <>
          <View style={styles.actions}>
            <ActionButton label="Scan a code on this plant" text="📷 Scan a code" disabled={atCodeCap || busy} onPress={() => setScanning(true)} t={t} />
            <ActionButton label="Generate a code for this plant" text="Generate a code" disabled={atCodeCap || busy} onPress={generate} t={t} />
          </View>
          <Text style={[styles.hint, { color: atCodeCap ? amber : t.sub }]}>
            {atCodeCap
              ? `Up to ${MAX_CODES_PER_PLANT} codes per plant — remove one to add another.`
              : "Any QR sticker works; the app stores only a fingerprint of it, never its contents."}
          </Text>
        </>
      )}

      {/* ---- Photo of the tag ---- */}
      <Text style={[styles.sectionTitle, { color: t.text }]}>Photo of the tag</Text>
      {tagPhotoUri ? (
        <View style={styles.photoRow}>
          <Pressable
            accessibilityRole="imagebutton"
            accessibilityLabel="Photo of this plant's tag. Tap to view, hold to remove."
            onPress={() => setViewing({ uri: tagPhotoUri, caption: `${plant.name} · tag` })}
            onLongPress={confirmRemovePhoto}
            style={[styles.photoThumbWrap, { borderColor: t.border }]}
          >
            <Image source={{ uri: tagPhotoUri }} style={styles.photoThumb} />
          </Pressable>
          <View style={styles.photoText}>
            <Text style={[styles.hint, { color: t.sub }]}>Tap to view · hold to remove</Text>
            <ActionButton label="Replace the tag photo" text="Replace" disabled={busy} onPress={() => void addPhoto("camera")} t={t} />
          </View>
        </View>
      ) : (
        <>
          {plant.tag_photo ? (
            <Text style={[styles.hint, { color: amber }]}>The tag photo is not on this phone — add a new one.</Text>
          ) : (
            <Text style={[styles.hint, { color: t.sub }]}>
              A picture of the installed tag is the backup when the tag itself goes missing.
            </Text>
          )}
          <View style={styles.actions}>
            <ActionButton label="Take a photo of the tag" text="📷 Take photo" disabled={busy} onPress={() => void addPhoto("camera")} t={t} />
            <ActionButton label="Choose a photo of the tag" text="Choose photo" disabled={busy} onPress={() => void addPhoto("gallery")} t={t} />
          </View>
        </>
      )}
      {busy ? <ActivityIndicator color={t.green} style={styles.busy} /> : null}

      {/* ---- Guidance (research §5) — behind a header once the plant is
          identified, open while it is not; every sentence stays. ---- */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="How to tag your trees"
        accessibilityState={{ expanded: rulesExpanded }}
        onPress={() => setRulesOpen(!rulesExpanded)}
        style={styles.rulesHeader}
      >
        <Text style={[styles.sectionTitle, { color: t.text }]}>How to tag your trees</Text>
        <Text style={[styles.rulesChevron, { color: t.sub }]}>{rulesExpanded ? "▾" : "▸"}</Text>
      </Pressable>
      {rulesExpanded
        ? TAGGING_RULES.map((rule) => (
            <View key={rule} style={styles.ruleRow}>
              <Text style={[styles.ruleBullet, { color: t.green }]}>•</Text>
              <Text style={[styles.rule, { color: t.sub }]}>{rule}</Text>
            </View>
          ))
        : null}

      {/* Scan-to-bind: the same viewfinder, shutter hidden; one "Scan tag"
          capture binds the code to THIS plant and closes (D-W15: a deliberate
          800 px still decoded in pure JS — no ML Kit). */}
      <Modal visible={scanning} animationType="slide" onRequestClose={closeScan}>
        <CaptureScreen scanTarget={plant.id} onClose={closeScan} />
      </Modal>
      <PlantPickerSheet
        visible={moving !== null}
        title="Move this code to…"
        plants={moving?.plants ?? []}
        selectedId={null}
        onSelect={(id) => void moveTo(id)}
        onClose={() => setMoving(null)}
      />
      <PhotoViewer photo={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

/** A ≥ 48 dp bordered button; tone carries colour, the text carries the word. */
function ActionButton({
  label,
  text,
  onPress,
  t,
  tone = "neutral",
  disabled = false,
}: {
  label: string;
  text: string;
  onPress: () => void;
  t: Tokens;
  tone?: "neutral" | "primary" | "danger";
  disabled?: boolean;
}) {
  const color = tone === "primary" ? t.onGreen : tone === "danger" ? t.danger : t.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        {
          borderColor: tone === "primary" ? t.green : tone === "danger" ? t.danger : t.border,
          backgroundColor: tone === "primary" ? t.green : "transparent",
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text style={[styles.buttonText, { color }]} numberOfLines={1}>
        {text}
      </Text>
    </Pressable>
  );
}

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    padding: 14,
    gap: 8,
  },
  cardLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  cardIntro: { fontSize: 13, lineHeight: 18 },
  notice: { fontSize: 13, fontWeight: "600" },
  sectionTitle: { fontSize: 15, fontWeight: "700", marginTop: 8 },
  tagRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 48 },
  tagValue: { fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"], flexShrink: 1 },
  tagEdit: { gap: 8 },
  input: {
    borderWidth: 1,
    borderRadius: RADIUS,
    minHeight: 48,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  fieldError: { fontSize: 12 },
  hint: { fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  button: {
    borderWidth: 1,
    borderRadius: RADIUS,
    minHeight: 48,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 1,
    flexBasis: 120,
  },
  buttonText: { fontSize: 14, fontWeight: "600" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 56,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  switchText: { flex: 1, gap: 2 },
  switchLabel: { fontSize: 14, fontWeight: "600" },
  switchState: { fontSize: 12, fontWeight: "600" },
  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 6,
  },
  codeText: { flex: 1, fontSize: 14, fontWeight: "600", fontFamily: MONO },
  generated: {
    borderWidth: 1,
    borderRadius: RADIUS,
    padding: 14,
    gap: 8,
    alignItems: "stretch",
  },
  generatedLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  generatedCode: {
    fontSize: 30,
    fontWeight: "700",
    fontFamily: MONO,
    letterSpacing: 2,
    textAlign: "center",
    paddingVertical: 6,
  },
  photoRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  photoThumbWrap: {
    width: 96,
    height: 96,
    borderRadius: RADIUS - 2,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  photoThumb: { width: "100%", height: "100%" },
  photoText: { flex: 1, gap: 8 },
  busy: { alignSelf: "flex-start" },
  rulesHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  rulesChevron: { fontSize: 16, fontWeight: "700", paddingHorizontal: 6 },
  ruleRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  ruleBullet: { fontSize: 13, lineHeight: 18 },
  rule: { flex: 1, fontSize: 13, lineHeight: 18 },
});
