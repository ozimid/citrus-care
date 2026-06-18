import { describe, expect, it } from "vitest";
import { loginSchema, signupSchema } from "@/app/_lib/auth-schemas";

describe("loginSchema", () => {
  it("accepts a valid email + password", () => {
    const r = loginSchema.safeParse({ email: "a@b.co", password: "12345678" });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const r = loginSchema.safeParse({ email: "not-email", password: "12345678" });
    expect(r.success).toBe(false);
  });

  it("rejects a short password", () => {
    const r = loginSchema.safeParse({ email: "a@b.co", password: "short" });
    expect(r.success).toBe(false);
  });
});

describe("signupSchema", () => {
  it("accepts a valid email + 8+ char password + captchaToken", () => {
    const r = signupSchema.safeParse({
      email: "a@b.co",
      password: "12345678",
      captchaToken: "cf-tok-xyz",
    });
    expect(r.success).toBe(true);
  });

  it("rejects passwords under 8 chars", () => {
    const r = signupSchema.safeParse({
      email: "a@b.co",
      password: "1234567",
      captchaToken: "cf-tok-xyz",
    });
    expect(r.success).toBe(false);
  });

  it("rejects passwords over 72 bytes (bcrypt limit)", () => {
    const r = signupSchema.safeParse({
      email: "a@b.co",
      password: "a".repeat(73),
      captchaToken: "cf-tok-xyz",
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing captchaToken", () => {
    const r = signupSchema.safeParse({ email: "a@b.co", password: "12345678" });
    expect(r.success).toBe(false);
  });

  it("rejects empty captchaToken", () => {
    const r = signupSchema.safeParse({
      email: "a@b.co",
      password: "12345678",
      captchaToken: "",
    });
    expect(r.success).toBe(false);
  });
});
