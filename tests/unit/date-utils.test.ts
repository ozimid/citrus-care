import { describe, expect, it } from "vitest";
import { formatDate } from "@/app/_lib/date-utils";

describe("formatDate", () => {
  it("formats dates older than 30 days without relative suffix", () => {
    const d = new Date("2026-01-01T12:00:00Z");
    const formatted = formatDate(d.toISOString());
    expect(formatted).toBe("Jan 1, 2026");
  });

  it("adds relative suffix for recent dates", () => {
    const today = new Date();
    expect(formatDate(today.toISOString())).toContain("(today)");

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatDate(yesterday.toISOString())).toContain("(1 day ago)");

    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    expect(formatDate(fiveDaysAgo.toISOString())).toContain("(5 days ago)");
  });

  it("handles invalid dates gracefully", () => {
    expect(formatDate("not-a-date")).toBe("Unknown date");
  });
});
