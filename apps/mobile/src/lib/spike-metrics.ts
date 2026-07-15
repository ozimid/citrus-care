// D-15 Stage 1 spike measurements, pure half: timer bookkeeping, run-log
// append, and pass/fail evaluation against the agreed go/no-go bar
// (docs/research/on-device-vlm-native.md §"Go/no-go bar"). The AsyncStorage
// wiring is the thin spike-metrics-io.ts (same split as photo-store.ts vs
// photo-store-io.ts). Measurement instrumentation only — NOT the production
// engine router.

/** Go/no-go bar agreed before building the spike. */
export const SPIKE_BAR = {
  /** Model download + first session init, one-time on WiFi. */
  coldInitMaxMs: 90_000,
  /** Session init when model files are already cached on the phone. */
  warmInitMaxMs: 10_000,
  /** Single-photo diagnosis prompt. */
  inferenceMaxMs: 15_000,
  /** Output must parse into the shared schema on >= parseMinPass of the last
   * parseWindow runs. */
  parseWindow: 5,
  parseMinPass: 3,
} as const;

export type InitKind = "cold" | "warm";

export type SpikeRunKind = "init-cold" | "init-warm" | "inference";

export interface SpikeRun {
  /** ISO timestamp of the run. */
  at: string;
  kind: SpikeRunKind;
  /** Wall-clock duration of the run. */
  ms: number;
  /** Inference runs only: did the output parse into assessmentDiagnosisSchema. */
  parseOk?: boolean;
}

export const RUN_LOG_STORAGE_KEY = "citrus.vlm-spike-runs.v1";

/** Enough history for several 5-run bar windows without unbounded growth. */
export const MAX_RUN_LOG = 25;

/** Cold = the resource fetcher actually downloaded (progress was observed
 * strictly between 0 and 1); warm = everything came from the local cache. */
export function classifyInit(sawDownload: boolean): InitKind {
  return sawDownload ? "cold" : "warm";
}

/** Time bar per run kind. Inference parse success is tallied over a window by
 * parseTally, not judged per run. */
export function runPassesBar(run: Pick<SpikeRun, "kind" | "ms">): boolean {
  switch (run.kind) {
    case "init-cold":
      return run.ms <= SPIKE_BAR.coldInitMaxMs;
    case "init-warm":
      return run.ms <= SPIKE_BAR.warmInitMaxMs;
    case "inference":
      return run.ms <= SPIKE_BAR.inferenceMaxMs;
  }
}

/** Newest-first append, capped at MAX_RUN_LOG. Never mutates the input. */
export function appendRun(log: SpikeRun[], run: SpikeRun): SpikeRun[] {
  return [run, ...log].slice(0, MAX_RUN_LOG);
}

export interface ParseTally {
  passed: number;
  total: number;
  verdict: "pass" | "fail" | "pending";
}

/** Schema-parse bar over the most recent SPIKE_BAR.parseWindow inference runs
 * (log is newest-first). Pass as soon as parseMinPass successes exist; fail
 * only once a full window holds fewer; pending otherwise. */
export function parseTally(log: SpikeRun[]): ParseTally {
  const window = log.filter((r) => r.kind === "inference").slice(0, SPIKE_BAR.parseWindow);
  const passed = window.filter((r) => r.parseOk === true).length;
  const total = window.length;
  const verdict =
    passed >= SPIKE_BAR.parseMinPass ? "pass" : total >= SPIKE_BAR.parseWindow ? "fail" : "pending";
  return { passed, total, verdict };
}

function isValidRun(value: unknown): value is SpikeRun {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.at === "string" &&
    (r.kind === "init-cold" || r.kind === "init-warm" || r.kind === "inference") &&
    typeof r.ms === "number" &&
    (r.parseOk === undefined || typeof r.parseOk === "boolean")
  );
}

/** Parse the stored run log. Stored data is untrusted: malformed JSON or
 * malformed entries degrade to an empty/partial log, never throw (same rule
 * as parsePhotoIndex). */
export function parseRunLog(json: string | null): SpikeRun[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidRun);
}

export function serializeRunLog(log: SpikeRun[]): string {
  return JSON.stringify(log);
}

/** Human-readable duration for the metrics table. */
export function formatMs(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}
