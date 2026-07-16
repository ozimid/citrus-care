import { describe, expect, it } from "vitest";
import { BMC_URL, FEEDBACK_EMAIL, buildFeedbackMailto } from "./support";

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
