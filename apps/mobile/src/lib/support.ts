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
