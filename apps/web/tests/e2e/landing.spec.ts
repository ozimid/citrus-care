import { test, expect } from "@playwright/test";

test("landing page shows hero and the get-the-app section", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /^citrus care$/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation").getByRole("link", { name: /get the app/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /from symptom photo to recovery record/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^get the app$/i }),
  ).toBeVisible();
  await expect(page.getByText(/development build — ask oleksii/i)).toBeVisible();
});

// D-16: the authenticated web surface is gone — /plants is not a page anymore.
test("/plants no longer exists (404)", async ({ page }) => {
  const res = await page.goto("/plants");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
});
