import { describe, expect, it } from "vitest";
import { newLocalId } from "./local-id";

describe("newLocalId", () => {
  it("is deterministic given the same time + randomness", () => {
    expect(newLocalId(1752573600000, 0.123456789)).toBe(newLocalId(1752573600000, 0.123456789));
  });

  it("looks like a lowercase base36 id", () => {
    expect(newLocalId(1752573600000, 0.5)).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });

  it("differs across time or randomness (collision resistance)", () => {
    expect(newLocalId(1752573600000, 0.1)).not.toBe(newLocalId(1752573600000, 0.2));
    expect(newLocalId(1752573600000, 0.1)).not.toBe(newLocalId(1752573600001, 0.1));
  });
});
