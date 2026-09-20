import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_BYTES_ESTIMATE,
  ASYNC_STORAGE_LIMIT_BYTES,
  ASYNC_STORAGE_SOFT_LIMIT_BYTES,
  canRunBatch,
  storageSummary,
} from "./storage-budget";
import { formatModelBytes } from "./model-catalogue";

// D-W17: Android's AsyncStorage is one 6 MB SQLite database and every store is
// a whole-blob rewrite, so the cliff is real and today it is silent. The guard
// refuses a batch BEFORE the model spends minutes on it, with copy the user can
// act on; the summary makes the two budgets visible on Profile.

const MiB = 1024 * 1024;

describe("budget constants", () => {
  it("soft limit sits below the Android default hard limit", () => {
    expect(ASYNC_STORAGE_SOFT_LIMIT_BYTES).toBeLessThan(ASYNC_STORAGE_LIMIT_BYTES);
  });
});

describe("canRunBatch", () => {
  it("refuses when the projected records total would pass the soft limit", () => {
    const verdict = canRunBatch(4.9 * MiB, 30);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // User-safe copy: a full sentence that says what to do, no byte counts,
    // no internal names.
    expect(verdict.reason).toMatch(/^[A-Z].*\.$/);
    expect(verdict.reason).toMatch(/backup/i);
    expect(verdict.reason).not.toMatch(/AsyncStorage|bytes|MiB/);
  });

  it("allows a batch that fits with room to spare", () => {
    expect(canRunBatch(1 * MiB, 30)).toEqual({ ok: true });
    expect(canRunBatch(0, 1)).toEqual({ ok: true });
  });

  it("projects with the per-assessment estimate (the boundary is exact)", () => {
    const room = ASYNC_STORAGE_SOFT_LIMIT_BYTES - 2 * ASSESSMENT_BYTES_ESTIMATE;
    expect(canRunBatch(room, 2).ok).toBe(true);
    expect(canRunBatch(room, 3).ok).toBe(false);
  });
});

// F40 follow-up: the phone-storage figure had its own binary formatter, so the
// same byte count read ~7% smaller here than in every model size on the same
// Profile screen. There is now ONE convention for space on the phone — the
// catalogue's decimal formatModelBytes, which is what Android's Storage screen
// counts in. (The records figure stays binary on purpose: it is a ratio
// against Android's own 6 MiB AsyncStorage cap, not a figure a user compares
// with the Storage screen.)
describe("storageSummary", () => {
  it("renders the photo total in the catalogue's one size convention", () => {
    expect(storageSummary(1.2 * MiB, 412 * MiB)).toBe(
      `Records: 1.2 of 6 MB · Photos: ${formatModelBytes(412 * MiB)}`,
    );
    expect(storageSummary(1.2 * MiB, 412 * MiB)).toContain("Photos: 432 MB");
  });

  it("renders both budgets on one line, and reads zero as zero", () => {
    expect(storageSummary(0, 0)).toBe("Records: 0.0 of 6 MB · Photos: 0 MB");
  });

  it("never renders garbage for a bad measurement", () => {
    expect(storageSummary(Number.NaN, -5)).toBe("Records: 0.0 of 6 MB · Photos: 0 MB");
  });
});
