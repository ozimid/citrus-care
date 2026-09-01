// Support & feedback links (pure). Both are LINK-OUTS the user taps — the app
// itself never sends anything (D-17: no telemetry). The version block in the
// feedback body exists because the user asked for troubleshooting context
// (F22's surviving intent); the user sees the draft and sends it themselves.

export const BMC_URL = "https://buymeacoffee.com/citruscare";
export const FEEDBACK_EMAIL = "feedback@citruscare.net";

const FEEDBACK_SUBJECT = "Citrus Care feedback";

/** mailto: URL with a prefilled draft; missing version info degrades to "—". */
export function buildFeedbackMailto(
  appVersion: string | null,
  androidVersion: string | number | null,
): string {
  const body = [
    "What happened (or what would make the app better)?",
    "",
    "",
    "---",
    `App version: ${appVersion ?? "—"}`,
    `Android version: ${androidVersion ?? "—"}`,
  ].join("\n");
  const params = new URLSearchParams({ subject: FEEDBACK_SUBJECT, body });
  // URLSearchParams encodes spaces as "+", which mail clients render literally
  // in mailto bodies — force %20 form.
  return `mailto:${FEEDBACK_EMAIL}?${params.toString().replace(/\+/g, "%20")}`;
}

/** Longest raw-model excerpt an email draft carries: mailto URLs past a few KB
 * fail to open in some mail clients. */
const DEBUG_RAW_MAX = 1_500;

/** mailto: draft carrying what a "Where to prune" run actually did, raw model
 * text included. The user sees the draft and sends it themself — the app still
 * transmits nothing (D-17). */
export function buildPruneDebugMailto(
  appVersion: string | null,
  info: {
    outcome: string;
    reason?: string;
    raw: string;
    subject?: string;
    cuts?: number;
    drawable?: number;
    dropped?: number;
  },
): string {
  const body = [
    "Where-to-prune run details (auto-filled — feel free to add what you saw):",
    "",
    `outcome: ${info.outcome}${info.reason ? ` (${info.reason})` : ""}`,
    `subject: ${info.subject ?? "—"} · cuts: ${info.cuts ?? 0} · drawable: ${info.drawable ?? 0} · dropped: ${info.dropped ?? 0}`,
    `app version: ${appVersion ?? "—"}`,
    "",
    "model output:",
    info.raw.slice(0, DEBUG_RAW_MAX),
  ].join("\n");
  const params = new URLSearchParams({ subject: "Where to prune — run details", body });
  return `mailto:${FEEDBACK_EMAIL}?${params.toString().replace(/\+/g, "%20")}`;
}

/** YouTube SEARCH for the plant class — deliberately not a specific video:
 * nothing to go stale, nothing to endorse. A link-out the user taps, exactly
 * like the BMC and feedback links (D-17: the app itself sends nothing). */
export function buildPruneVideoSearchUrl(packLabel: string): string {
  const query = `how to prune a ${packLabel.toLowerCase()}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

/** mailto: draft carrying what a DIAGNOSIS run actually did — same channel as
 * the prune one, different subject line. */
export function buildAssessDebugMailto(
  appVersion: string | null,
  info: { outcome: string; reason?: string; raw: string },
): string {
  const body = [
    "Analysis run details (auto-filled — add what you saw):",
    "",
    `outcome: ${info.outcome}${info.reason ? ` (${info.reason})` : ""}`,
    `app version: ${appVersion ?? "—"}`,
    "",
    "model output:",
    info.raw.slice(0, DEBUG_RAW_MAX),
  ].join("\n");
  const params = new URLSearchParams({ subject: "Analysis — run details", body });
  return `mailto:${FEEDBACK_EMAIL}?${params.toString().replace(/\+/g, "%20")}`;
}

/** mailto: draft sharing a Device Check verdict — the D-17-compatible device
 * matrix: users volunteer their numbers, the app transmits nothing. */
export function buildDeviceCheckMailto(
  appVersion: string | null,
  verdict: { pass: boolean; parseRate: number; medianMs: number; device: string },
): string {
  const body = [
    `Device Check: ${verdict.pass ? "PASS" : "FAIL"}`,
    `parse rate: ${Math.round(verdict.parseRate * 100)}% · median inference: ${verdict.medianMs} ms`,
    `device: ${verdict.device}`,
    `app version: ${appVersion ?? "—"}`,
  ].join("\n");
  const params = new URLSearchParams({ subject: "Device Check result", body });
  return `mailto:${FEEDBACK_EMAIL}?${params.toString().replace(/\+/g, "%20")}`;
}
