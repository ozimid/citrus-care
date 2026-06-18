import { test, expect } from "@playwright/test";

test("landing page shows hero and auth links", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /citrus tree/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /get started/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /log in/i })).toBeVisible();
});

test("anonymous /trees redirects to /login", async ({ page }) => {
  const res = await page.goto("/trees");
  await expect(page).toHaveURL(/\/login(\?|$)/);
  expect(res?.ok()).toBeTruthy();
  await expect(
    page.getByRole("heading", { name: /welcome back/i }),
  ).toBeVisible();
});
