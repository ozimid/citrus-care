// F40 "Choose your model", IO half: which on-device model this phone runs,
// which models' weights are actually on it, and the delete that reclaims the
// space. Thin wiring (README testing policy) — every number, label and licence
// comes from the pure model-catalogue.ts, which is where the tests live.
//
// WHERE THE WEIGHTS LIVE — read out of the installed packages, never guessed:
//   react-native-executorch-expo-resource-fetcher/lib/constants/directories.js
//     RNEDirectory = `${documentDirectory}react-native-executorch/`
//   …/lib/handlers.js downloads into the CACHE directory and moves the file
//     into RNEDirectory only after the download completes — so a file sitting
//     there is always a finished download, never a half one.
//   react-native-executorch/lib/module/utils/ResourceFetcherUtils.js names each
//     file getFilenameFromUri(url): the url minus its scheme, with every
//     character outside [A-Za-z0-9._-] replaced by "_".
// The on-disk name of every file a model downloads therefore contains that
// model's own Hugging Face path segments, which is what MODEL_FILE_TOKENS
// matches. Deliberately NOT matched: the `resolve/v0.9.0` version tag — a
// library bump moves that but not the model's path — and nothing outside this
// one directory is ever listed, let alone deleted.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { LOCAL_ENGINE_STORAGE_KEY, parseLocalEngineSettings } from "./local-engine";
import {
  DEFAULT_MODEL_ID,
  parseModelChoice,
  serializeModelChoice,
  type ModelId,
} from "./model-catalogue";

export const MODEL_CHOICE_KEY = "citrus.model-choice.v1";

/** The library's own download directory, under app documents. */
const WEIGHTS_DIR_NAME = "react-native-executorch";

/** Substrings that appear in the sanitized filename of EVERY file a given model
 * downloads (its .pte and its two tokenizer files). Checked against the names
 * inside WEIGHTS_DIR_NAME only:
 *   gemma  → …react-native-executorch-gemma-4-multimodal_resolve_v0.9.0_e2b_vulkan_gemma_4_e2b_vulkan_8da4w.pte
 *            (the .pte comes from the MULTIMODAL repo — modelUrls.js:137;
 *             only the tokenizer lives in the plain `-gemma-4` repo, :133)
 *            …react-native-executorch-gemma-4_resolve_v0.9.0_e2b_tokenizer.json
 *   lfm    → …react-native-executorch-lfm-2.5_resolve_v0.9.0_vl_450m_xnnpack_lfm_2_5_vl_450m_xnnpack_8da4w.pte
 *            …react-native-executorch-lfm-2.5_resolve_v0.9.0_vl_450m_tokenizer.json
 * "vl_450m" is used for the LFM rather than "lfm" because the same repo also
 * serves the 350M/1.2B/1.6B models (whose paths are vl_1_6b, etc.) — this app
 * must never touch those. Verified against constants/modelUrls.js. */
const MODEL_FILE_TOKENS: Record<ModelId, readonly string[]> = {
  "gemma4-e2b": ["gemma-4", "gemma_4"],
  "lfm2-5-vl-450m": ["vl_450m", "vl-450m"],
};

const ALL_MODEL_IDS = Object.keys(MODEL_FILE_TOKENS) as ModelId[];

/** Flat list of the files the library has downloaded. Throws only if the
 * platform refuses the read; an absent directory is simply "nothing yet". */
function listWeightFiles(): File[] {
  const dir = new Directory(Paths.document, WEIGHTS_DIR_NAME);
  if (!dir.exists) return [];
  return dir.list().filter((entry): entry is File => entry instanceof File);
}

function belongsTo(id: ModelId, fileName: string): boolean {
  const name = fileName.toLowerCase();
  return MODEL_FILE_TOKENS[id].some((token) => name.includes(token));
}

function filesFor(id: ModelId): File[] {
  return listWeightFiles().filter((file) => belongsTo(id, file.name));
}

/** The user's explicit choice. `null` = never chosen on this phone. Untrusted
 * read: anything the catalogue doesn't recognise degrades to null, so a corrupt
 * value can never point the engine at a model that doesn't exist. */
export async function loadModelChoice(): Promise<ModelId | null> {
  try {
    return parseModelChoice(await AsyncStorage.getItem(MODEL_CHOICE_KEY));
  } catch (e) {
    console.error("[model-choice-io] choice read failed:", (e as Error).message);
    return null;
  }
}

export async function saveModelChoice(id: ModelId): Promise<void> {
  await AsyncStorage.setItem(MODEL_CHOICE_KEY, serializeModelChoice(id));
}

/** Which models have finished weights on this phone. Best-effort: a read that
 * fails reads as "none downloaded", which only ever costs a redundant offer to
 * download — it can never delete anything or hide a model that is in use. */
export async function downloadedModelIds(): Promise<ModelId[]> {
  try {
    const files = listWeightFiles();
    return ALL_MODEL_IDS.filter((id) =>
      files.some((file) => belongsTo(id, file.name) && file.name.toLowerCase().endsWith(".pte")),
    );
  } catch (e) {
    console.error("[model-choice-io] weights listing failed:", (e as Error).message);
    return [];
  }
}

/** Bytes this model's files occupy on the phone — what "Free up space" is
 * allowed to promise back. 0 when nothing is there or the read fails. */
export async function modelWeightsBytes(id: ModelId): Promise<number> {
  try {
    return filesFor(id).reduce((total, file) => total + (file.size ?? 0), 0);
  } catch (e) {
    console.error("[model-choice-io] weights measurement failed:", (e as Error).message);
    return 0;
  }
}

/** Which model this launch runs.
 *  1. An explicit stored choice always wins.
 *  2. Otherwise the weights already on disk decide — a phone that downloaded
 *     Gemma under an older build keeps running Gemma: no forced re-download,
 *     no silent switch.
 *  3. If the disk can't be read at all, the pre-F40 engine setting is the last
 *     witness: `downloaded: true` could only ever have meant Gemma.
 *  4. Only a phone with no model at all gets the catalogue's default. */
export async function resolveStartupModel(): Promise<ModelId> {
  const stored = await loadModelChoice();
  if (stored) return stored;

  const onDisk = await downloadedModelIds();
  if (onDisk.includes("gemma4-e2b")) return "gemma4-e2b";
  if (onDisk.length === 1) return onDisk[0];
  if (onDisk.length === 0 && (await legacyGemmaInstall())) return "gemma4-e2b";

  return DEFAULT_MODEL_ID;
}

/** Pre-F40 installs had exactly one model, so the old "downloaded" flag names
 * it. Read degrades to false — a wrong `true` would offer Gemma to a phone that
 * has no weights, a wrong `false` only re-offers the choice. */
async function legacyGemmaInstall(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_ENGINE_STORAGE_KEY);
    return parseLocalEngineSettings(raw).downloaded;
  } catch (e) {
    console.error("[model-choice-io] legacy settings read failed:", (e as Error).message);
    return false;
  }
}

/** Delete one model's weights to reclaim the space. Refuses the model this
 * phone is actually running — the only way to remove that one is to switch
 * first, so a tap can never leave the app with no engine. Throws on a failed
 * delete (the caller shows a generic message; details go to console.error).
 *
 * `inUseId` is REQUIRED and comes from the provider — the model genuinely
 * mounted right now. Re-deriving it here (resolveStartupModel) was a second
 * source of truth that could disagree with the first: loadModelChoice degrades
 * to null on a transient read failure, and the disk fallback prefers Gemma, so
 * a phone holding both models while running the LFM could be told its live
 * model was Gemma — and then permitted to delete the weights under itself. */
export async function deleteModelWeights(id: ModelId, inUseId: ModelId): Promise<void> {
  if (id === inUseId) {
    throw new Error("refusing to delete the model in use");
  }
  // Re-listed here, inside the directory the fetcher owns: every path comes
  // from Directory.list(), never from a name this app composed.
  for (const file of filesFor(id)) {
    if (file.exists) file.delete();
  }
}
