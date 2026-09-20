// F40 — the ONE place a model's download size is stated. Pure: no expo, no
// react-native, no executorch import (the registry lives in the session
// component; this module only has to agree with it by name).
//
// Why it exists: the app shipped "~1.3 GB download · needs ~2 GB free" while
// the Android build of Gemma 4 E2B is 4,371,419,520 B of .pte plus
// 32,169,868 B of tokenizer — 4.4 GB. A phone with 2.5 GB free passed the
// precheck and then filled up. Sizes are now measured, stored once here, and
// every copy string in the app derives from this file. Nothing hand-types a
// size again.
//
// Byte counts are content-length readings against the exact URLs the installed
// react-native-executorch resolves (its constants/versions.js pins
// LIB_VERSION = 0.9.0, so VERSION_TAG is `resolve/v0.9.0`; the npm package
// version and the weights tag are not the same number):
//   models.llm.gemma4_e2b_multimodal() → GEMMA4_E2B_MM (modelUrls.js:152-158),
//     whose Android .pte is the MULTIMODAL repo — not the plain `-gemma-4` one:
//        …/react-native-executorch-gemma-4-multimodal
//          /resolve/v0.9.0/e2b/vulkan/gemma_4_e2b_vulkan_8da4w.pte   (4,371,419,520 B)
//     while only the tokenizer comes from the plain repo (modelUrls.js:133):
//        …/react-native-executorch-gemma-4/resolve/v0.9.0/e2b/tokenizer.json
//     The same filename exists under `-gemma-4` at 2,570,073,732 B — a
//     DIFFERENT, text-only build. Measure the multimodal path or the number
//     comes out ~1.8 GB short, which is the bug this file exists to kill.
//   models.llm.lfm2_5_vl_450m()        → …/react-native-executorch-lfm-2.5
//        /resolve/v0.9.0/vl_450m/xnnpack/lfm_2_5_vl_450m_xnnpack_8da4w.pte
//        + vl_450m/tokenizer.json
// A library bump moves the tag, not the sizes' order of magnitude — but if the
// download ever looks nothing like `bytes` here, re-measure before editing copy.

export type ModelId = "lfm2-5-vl-450m" | "gemma4-e2b";

export interface ModelSpec {
  id: ModelId;
  /** The model's own name, as its maker publishes it. */
  label: string;
  maker: string;
  /** Licence name, shown in the attribution line. */
  licence: string;
  /** Where the full licence text lives (the LFM Open License v1.0 requires it). */
  licenceUrl: string;
  /** Measured download: the .pte plus its tokenizer.json. Each model also
   * fetches a tokenizer_config.json (22,312 B for Gemma, 3,071 B for the LFM)
   * — excluded as negligible: 0.0005% of the total, far inside the 1.35x
   * headroom below. A re-measurement that lands within a few KB agrees. */
  bytes: number;
  /** `bytes` in the one display convention — never hand-typed. */
  sizeLabel: string;
  /** Free space the precheck demands: the download plus unpack headroom. */
  requiredFreeBytes: number;
  requiredFreeLabel: string;
  /** What is KNOWN: size class, memory, speed class. Never an accuracy claim —
   * neither model has been tested on real plant photos. */
  blurb: string;
  /** Below this, loading the model is not worth attempting on this phone.
   * Binary bytes, because that is how a phone's RAM is specced ("8 GB" = 8 GiB). */
  minRamBytes: number;
}

const GiB = 1024 ** 3;

/** Unpack + runtime cache headroom over the raw download. */
const HEADROOM_MULTIPLIER = 1.35;
/** The free-space requirement is rounded up to this, so it reads as a number a
 * human can act on ("6.0 GB") rather than a measurement. Decimal, like the
 * rest of the size convention. */
const FREE_SPACE_ROUNDING_BYTES = 50_000_000;

/** THE size convention, defined once: decimal GB/MB — the units an Android
 * Storage screen counts in, so the number here matches the number the phone
 * shows. One decimal for GB, whole MB below a gigabyte. Used for download
 * sizes, for the free-space requirement AND for the phone's actual free
 * space, so the two are never compared in different units. */
export function formatModelBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = Math.round(bytes / 1_000_000);
  if (mb < 1000) return `${mb} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

function requiredFreeFor(bytes: number): number {
  return Math.ceil((bytes * HEADROOM_MULTIPLIER) / FREE_SPACE_ROUNDING_BYTES) * FREE_SPACE_ROUNDING_BYTES;
}

function spec(
  input: Omit<ModelSpec, "sizeLabel" | "requiredFreeBytes" | "requiredFreeLabel">,
): ModelSpec {
  const requiredFreeBytes = requiredFreeFor(input.bytes);
  return {
    ...input,
    sizeLabel: formatModelBytes(input.bytes),
    requiredFreeBytes,
    requiredFreeLabel: formatModelBytes(requiredFreeBytes),
  };
}

export const MODEL_CATALOGUE: Record<ModelId, ModelSpec> = {
  "lfm2-5-vl-450m": spec({
    id: "lfm2-5-vl-450m",
    label: "LFM2.5-VL-450M",
    maker: "Liquid AI",
    licence: "LFM Open License v1.0",
    licenceUrl: "https://huggingface.co/LiquidAI/LFM2.5-VL-450M/blob/main/LICENSE",
    // 648,917,376 (.pte) + 4,733,040 (tokenizer)
    bytes: 653_650_416,
    blurb:
      "The light one. Much smaller download, lowest memory use, and it runs on phones the heavy one cannot. It should answer faster, though nothing in this app has timed it — and it has never run this app's prompts, so how it reads plants has not been measured.",
    // A 450M model quantized to 8da4w: the weights are well under a gigabyte
    // and the runtime footprint with them. The bar has to clear the phones
    // this model exists for — expo-device reports ActivityManager's totalMem,
    // so a phone sold as "4 GB RAM" reads ~3.5-3.8 GiB. A 4 GiB bar blocked
    // exactly those phones from the option added to serve them.
    minRamBytes: 2.5 * GiB,
  }),
  "gemma4-e2b": spec({
    id: "gemma4-e2b",
    label: "Gemma 4 E2B",
    maker: "Google",
    // Verified 2026-09-19 against Google's own licence page (last updated
    // 2026-04-01): Gemma 4 is Apache-2.0, unlike Gemma 1-3, which shipped
    // under the bespoke Gemma Terms. A separate prohibited-use policy sits
    // alongside it. The HF card for google/gemma-4-E2B-it agrees
    // (cardData.license = apache-2.0, ungated).
    licence: "Apache-2.0",
    licenceUrl: "https://ai.google.dev/gemma/docs/gemma_4_license",
    // 4,371,419,520 (.pte) + 32,169,868 (tokenizer)
    bytes: 4_403_589_388,
    blurb:
      "The heavy one. Far bigger download, needs much more free space and memory, and takes longer per photo. This app's prompts — and its pruning box format — were written and tested against this model.",
    minRamBytes: 6 * GiB,
  }),
};

/** The only model a pre-F40 install could have downloaded: before the choice
 * existed there was exactly one, so the old `downloaded: true` flag names it. */
export const LEGACY_MODEL_ID: ModelId = "gemma4-e2b";

/** A new install starts light: it is the download a user can actually finish,
 * and nothing measured says the heavy one reads plants any better. */
export const DEFAULT_MODEL_ID: ModelId = "lfm2-5-vl-450m";

/** Own-property test. `in` and `[]` walk Object.prototype, so "constructor"
 * and "toString" would otherwise read as catalogue entries — and the stored
 * choice is an untrusted string. */
function isKnownId(value: string): value is ModelId {
  return Object.prototype.hasOwnProperty.call(MODEL_CATALOGUE, value);
}

/** Unknown ids (a stale store, a downgraded build) resolve to the default
 * rather than throwing — a model id is never worth crashing a screen for. */
export function modelSpec(id: ModelId): ModelSpec {
  return typeof id === "string" && isKnownId(id)
    ? MODEL_CATALOGUE[id]
    : MODEL_CATALOGUE[DEFAULT_MODEL_ID];
}

/** The honest precheck number: the real download plus unpack headroom, per
 * model — not the flat 2 GiB constant that let a 2.5 GB phone start a 4.4 GB
 * download. */
export function requiredFreeBytesFor(id: ModelId): number {
  return modelSpec(id).requiredFreeBytes;
}

/** Is there room for this model? `null`/NaN means the free-space read failed —
 * never block on that: a precheck that cannot read the disk must not become a
 * second failure mode, and the download itself is the backstop. */
export function hasRoomFor(id: ModelId, freeBytes: number | null): boolean {
  if (freeBytes === null || !Number.isFinite(freeBytes)) return true;
  return freeBytes >= requiredFreeBytesFor(id);
}

/** Which OTHER model would fit in `freeBytes`, if any. A "not enough space"
 * refusal that only says "go delete photos" is a dead end when the app's own
 * lighter model would install fine — this is how the refusal names the way
 * out. Returns null when the reading is unknown (nothing was refused) or when
 * nothing else fits. Reports only; it never starts a download. */
export function modelThatFits(excluding: ModelId, freeBytes: number | null): ModelId | null {
  if (freeBytes === null || !Number.isFinite(freeBytes)) return null;
  const fits = (Object.keys(MODEL_CATALOGUE) as ModelId[])
    .filter((id) => id !== excluding && hasRoomFor(id, freeBytes))
    // Smallest first: the one most likely to actually finish.
    .sort((a, b) => MODEL_CATALOGUE[a].bytes - MODEL_CATALOGUE[b].bytes);
  return fits[0] ?? null;
}

/** Untrusted read of the stored choice. Anything that is not exactly a known
 * id reads as "not chosen yet" (null), never as a guess. */
export function parseModelChoice(raw: string | null): ModelId | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return isKnownId(trimmed) ? trimmed : null;
}

export function serializeModelChoice(id: ModelId): string {
  return id;
}

/** What is actually known about the two models, said once and used everywhere
 * the choice is offered.
 *
 * It used to read "the difference is size and download time, not accuracy" —
 * an assertion of PARITY that nobody measured, which is the same trust-
 * calibration error as asserting superiority. Worse, it buried the one
 * provenance fact that makes the choice informed: this app's prompts, and the
 * pruning `box_2d` convention (D-P2), were written and tuned against Gemma
 * (docs/design/plant-tools.md §4c). The light model has never run them here.
 * Say that; claim nothing about which reads a leaf better, because nobody
 * compared them. */
export function modelTestingNote(): string {
  const lfm = MODEL_CATALOGUE["lfm2-5-vl-450m"];
  const gemma = MODEL_CATALOGUE["gemma4-e2b"];
  return (
    `We have not compared the two on plant photos, so we can't say which reads a leaf better. ` +
    `What we can say: this app's prompts were written and tested against ${gemma.label} — ` +
    `${lfm.label} has never run them here. It is a far smaller download and should answer faster.`
  );
}

/** One row per model so the licence TEXT is reachable, not just named. The LFM
 * Open License v1.0 §4(a)/§4(d) requires shipping the licence and the notice;
 * a licence the user cannot open is hedging aimed at a lawyer, not at them.
 * Nothing is fetched here — the URL is opened only when the user taps it, so
 * the app still transmits nothing on its own (D-17). */
export function modelLicenceLinks(): {
  id: ModelId;
  label: string;
  licence: string;
  url: string;
}[] {
  return (Object.keys(MODEL_CATALOGUE) as ModelId[]).map((id) => {
    const spec = MODEL_CATALOGUE[id];
    return {
      id,
      label: `${spec.label}: read the ${spec.licence}`,
      licence: spec.licence,
      url: spec.licenceUrl,
    };
  });
}

/** The attribution the LFM Open License v1.0 requires, and plain good manners
 * for Gemma: both models, both makers, both licences, in one line. */
export function modelAttribution(): string {
  const lfm = MODEL_CATALOGUE["lfm2-5-vl-450m"];
  const gemma = MODEL_CATALOGUE["gemma4-e2b"];
  return (
    `Plant photos are read on this phone by an open model: ` +
    `${lfm.label} by ${lfm.maker}, used under the ${lfm.licence}, or ` +
    `${gemma.label} by ${gemma.maker}, used under the ${gemma.licence}. ` +
    `Neither maker made or endorses this app.`
  );
}
