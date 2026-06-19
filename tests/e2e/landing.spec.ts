import { test, expect } from "@playwright/test";

test("landing page shows hero and auth links", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /^citrus care$/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation").getByRole("link", { name: /get started/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation").getByRole("link", { name: /log in/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /view care workspace/i })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /from symptom photo to recovery record/i }),
  ).toBeVisible();
});

test("anonymous /plants redirects to /login", async ({ page }) => {
  const res = await page.goto("/plants");
  await expect(page).toHaveURL(/\/login(\?|$)/);
  expect(res?.ok()).toBeTruthy();
  await expect(
    page.getByRole("heading", { name: /welcome back/i }),
  ).toBeVisible();
});
