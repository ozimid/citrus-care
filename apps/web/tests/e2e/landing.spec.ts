import { test, expect } from "@playwright/test";

test("landing page shows hero and the get-the-app section", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /^citrus care$/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation").getByRole("link", { name: /download for android/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /from symptom photo to recovery record/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^get the app$/i }),
  ).toBeVisible();
  // D-17: no account, on-device AI — the download link, not "ask Oleksii".
  await expect(page.getByRole("link", { name: /download the apk/i })).toBeVisible();
  // Support section: BMC + the routed feedback address (zero-backend feedback).
  const feedback = page.getByRole("link", { name: /feedback@citruscare\.net/i });
  await expect(feedback).toBeVisible();
  await expect(feedback).toHaveAttribute("href", /^mailto:feedback@citruscare\.net/);
});

// D-17: no accounts, nothing synced — the privacy note says exactly that.
test("privacy page states nothing is collected", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: /^privacy$/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /what we collect/i })).toBeVisible();
});

// D-16: the authenticated web surface is gone — /plants is not a page anymore.
test("/plants no longer exists (404)", async ({ page }) => {
  const res = await page.goto("/plants");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
});
