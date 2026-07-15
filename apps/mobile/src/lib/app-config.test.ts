import { describe, expect, it } from "vitest";
import { resolveAppConfig } from "./app-config";

const extra = {
  supabaseUrl: "https://project.supabase.co",
  supabaseAnonKey: "anon-key-from-extra",
  googleWebClientId: "web-id.apps.googleusercontent.com",
  googleIosClientId: "YOUR_IOS_CLIENT_ID.apps.googleusercontent.com",
  googleAndroidClientId: "YOUR_ANDROID_CLIENT_ID.apps.googleusercontent.com",
};

describe("resolveAppConfig", () => {
  it("reads values from expo config extra", () => {
    const config = resolveAppConfig(extra, {});
    expect(config.supabaseUrl).toBe("https://project.supabase.co");
    expect(config.supabaseAnonKey).toBe("anon-key-from-extra");
    expect(config.googleWebClientId).toBe("web-id.apps.googleusercontent.com");
  });

  it("lets EXPO_PUBLIC_* env vars override extra (so secrets stay out of app.json)", () => {
    const config = resolveAppConfig(extra, {
      EXPO_PUBLIC_SUPABASE_URL: "https://env.supabase.co",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon-key-from-env",
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "env-web-id.apps.googleusercontent.com",
    });
    expect(config.supabaseUrl).toBe("https://env.supabase.co");
    expect(config.supabaseAnonKey).toBe("anon-key-from-env");
    expect(config.googleWebClientId).toBe("env-web-id.apps.googleusercontent.com");
  });

  it("treats YOUR_* placeholders as unset", () => {
    const config = resolveAppConfig(extra, {});
    expect(config.googleIosClientId).toBeUndefined();
    expect(config.googleAndroidClientId).toBeUndefined();
  });

  it("lists required keys that are missing or placeholders", () => {
    const config = resolveAppConfig(
      { ...extra, supabaseUrl: "YOUR_SUPABASE_URL", supabaseAnonKey: undefined },
      {},
    );
    expect(config.missing).toEqual(["supabaseUrl", "supabaseAnonKey"]);
    expect(config.supabaseUrl).toBe("");
  });

  it("reports nothing missing when required values are present", () => {
    expect(resolveAppConfig(extra, {}).missing).toEqual([]);
  });

  it("survives a completely absent extra block", () => {
    const config = resolveAppConfig(undefined, {});
    expect(config.missing).toEqual(["supabaseUrl", "supabaseAnonKey"]);
  });
});
