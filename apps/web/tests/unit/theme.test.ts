import { describe, expect, it } from "vitest";
import { resolveIsDark, THEME_COLOR } from "@/app/_lib/theme";

describe("resolveIsDark", () => {
  it("forces dark when the stored preference is 'dark', regardless of OS", () => {
    expect(resolveIsDark("dark", false)).toBe(true);
    expect(resolveIsDark("dark", true)).toBe(true);
  });

  it("forces light when the stored preference is 'light', regardless of OS", () => {
    expect(resolveIsDark("light", true)).toBe(false);
    expect(resolveIsDark("light", false)).toBe(false);
  });

  it("follows the OS when the preference is 'system'", () => {
    expect(resolveIsDark("system", true)).toBe(true);
    expect(resolveIsDark("system", false)).toBe(false);
  });

  it("follows the OS when nothing is stored (unset / null)", () => {
    expect(resolveIsDark(null, true)).toBe(true);
    expect(resolveIsDark(null, false)).toBe(false);
  });

  it("treats any unrecognized stored value as system", () => {
    expect(resolveIsDark("garbage", true)).toBe(true);
    expect(resolveIsDark("garbage", false)).toBe(false);
  });

  it("keeps the historical amber tint for light chrome", () => {
    expect(THEME_COLOR.light).toBe("#fef3c7");
  });
});
