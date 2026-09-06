import { test, expect } from "@playwright/test";

test("landing page shows hero and the get-the-app section", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /plant care, one photo at a time/i }),
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
  await page.screenshot({ path: testInfo.outputPath("landing-desktop.png"), fullPage: true, animations: "disabled" });
});

test("care walkthrough can be explored with a keyboard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /photo/i }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /insights/i })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText("Understand the likely causes");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: /progress/i })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText("See what changes over time");
  await expect(page.getByText("Example plant care journey", { exact: true })).toBeVisible();
  await expect(page.getByText("Sample data, not a live analysis.", { exact: true })).toBeVisible();
});

test("small screens retain navigation and an unobstructed download", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const panelHeights: number[] = [];
  for (const name of ["Photo", "Insights", "Progress"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    panelHeights.push((await page.getByRole("tabpanel").boundingBox())!.height);
  }
  expect(new Set(panelHeights).size).toBe(1);
  await page.getByRole("navigation").getByRole("link", { name: /download for android/i }).click();
  await expect(page).toHaveURL(/#get-the-app$/);
  const download = page.getByRole("link", { name: /download the apk/i });
  await expect(download).toBeInViewport();
  const box = await download.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath("landing-mobile.png"), fullPage: true, animations: "disabled" });
});

test("theme choice persists and narrow layouts support larger text", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const system = page.getByRole("radio", { name: "System", exact: true });
  await system.focus();
  await page.keyboard.press("ArrowRight");
  const dark = page.getByRole("radio", { name: "Dark", exact: true });
  await expect(dark).toBeFocused();
  const target = await dark.boundingBox();
  expect(target?.width).toBeGreaterThanOrEqual(44);
  expect(target?.height).toBeGreaterThanOrEqual(44);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(dark).toBeChecked();
  await page.getByRole("tab", { name: "Progress", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("landing-dark-mobile.png"), fullPage: true, animations: "disabled" });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await page.screenshot({ path: testInfo.outputPath("landing-enlarged-text.png"), fullPage: true, animations: "disabled" });
  const overflowing = await page.locator(".landing-page *").evaluateAll((elements) =>
    elements.filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .map((element) => `${element.tagName}.${element.className}`).slice(0, 10),
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth), overflowing.join("\n")).toBeLessThanOrEqual(375);
});

test("reduced motion keeps the walkthrough usable without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("tab", { name: /progress/i }).click();
  await expect(page.getByRole("tabpanel")).toContainText("See what changes over time");
  expect(await page.getByRole("tabpanel").evaluate((panel) => getComputedStyle(panel).animationName)).toBe("none");
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);
});

test("the essential care and download content works without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Plant care,");
  await expect(page.getByRole("heading", { name: /start with a photo/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /from symptom photo to recovery record/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /download the apk/i })).toHaveAttribute("href", /releases\/latest\/download\/citrus-care.apk$/);
  await context.close();
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

test("pruning guides render from the shared packs", async ({ page }) => {
  await page.goto("/guides");
  await expect(page.getByRole("heading", { name: /when — and where — to prune/i })).toBeVisible();
  await page.getByRole("link", { name: /how to prune a citrus tree/i }).click();
  await expect(page.getByRole("heading", { name: /how to prune a citrus tree/i })).toBeVisible();
  await expect(page.getByText(/branch collar/i).first()).toBeVisible();
  await expect(page.getByText(/Mar–May/).first()).toBeVisible();
});
