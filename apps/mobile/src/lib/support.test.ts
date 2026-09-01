import { describe, expect, it } from "vitest";
import { BMC_URL, FEEDBACK_EMAIL, buildFeedbackMailto, buildPruneDebugMailto, buildPruneVideoSearchUrl, buildDeviceCheckMailto } from "./support";

describe("support links", () => {
  it("points at the real Buy Me a Coffee page", () => {
    expect(BMC_URL).toBe("https://buymeacoffee.com/citruscare");
  });

  it("uses the routed feedback address", () => {
    expect(FEEDBACK_EMAIL).toBe("feedback@citruscare.net");
  });
});

describe("buildFeedbackMailto", () => {
  it("targets the feedback address with the standard subject", () => {
    const url = buildFeedbackMailto("0.1.0", 34);
    expect(url.startsWith(`mailto:${FEEDBACK_EMAIL}?`)).toBe(true);
    expect(url).toContain(`subject=${encodeURIComponent("Citrus Care feedback")}`);
  });

  it("embeds app and Android versions in the body for troubleshooting", () => {
    const url = buildFeedbackMailto("0.1.0", 34);
    const body = decodeURIComponent(url.split("body=")[1]);
    expect(body).toContain("App version: 0.1.0");
    expect(body).toContain("Android version: 34");
  });

  it("degrades missing versions to a dash instead of failing", () => {
    const url = buildFeedbackMailto(null, null);
    const body = decodeURIComponent(url.split("body=")[1]);
    expect(body).toContain("App version: —");
    expect(body).toContain("Android version: —");
  });

  it("produces a fully encoded URL (no raw spaces or newlines)", () => {
    const url = buildFeedbackMailto("0.1.0", "14");
    expect(url).not.toMatch(/[ \n]/);
  });
});

describe("buildPruneDebugMailto", () => {
  it("prefills the failure details the user chooses to send", () => {
    const url = buildPruneDebugMailto("0.1.6", {
      outcome: "unreadable",
      reason: "no-json",
      raw: "model said things",
    });
    expect(url.startsWith(`mailto:${FEEDBACK_EMAIL}?`)).toBe(true);
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("unreadable");
    expect(decoded).toContain("no-json");
    expect(decoded).toContain("model said things");
    expect(decoded).not.toContain("+");
  });

  it("truncates a runaway raw answer so the mailto stays openable", () => {
    const url = buildPruneDebugMailto("0.1.6", {
      outcome: "planned",
      raw: "x".repeat(10_000),
      cuts: 3,
      drawable: 0,
      dropped: 3,
    });
    expect(url.length).toBeLessThan(4_000);
    expect(decodeURIComponent(url)).toContain("dropped: 3");
  });
});

describe("buildPruneVideoSearchUrl", () => {
  // A general search, not a specific video: nothing to go stale, nothing to
  // endorse, and the user taps it themself (link-out, like BMC/feedback).
  it("builds a YouTube search for the plant class", () => {
    expect(buildPruneVideoSearchUrl("Citrus tree")).toBe(
      "https://www.youtube.com/results?search_query=how%20to%20prune%20a%20citrus%20tree",
    );
    expect(buildPruneVideoSearchUrl("Rose")).toContain("how%20to%20prune%20a%20rose");
  });
});

describe("buildDeviceCheckMailto", () => {
  it("carries the verdict numbers the user chooses to share", () => {
    const url = buildDeviceCheckMailto("0.1.7", {
      pass: true,
      parseRate: 0.8,
      medianMs: 12000,
      device: "SM-S911B · Android 14",
    });
    const decoded = decodeURIComponent(url);
    expect(url.startsWith(`mailto:${FEEDBACK_EMAIL}?`)).toBe(true);
    expect(decoded).toContain("PASS");
    expect(decoded).toContain("12000");
    expect(decoded).toContain("SM-S911B");
  });
});
