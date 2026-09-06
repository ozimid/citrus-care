import { test, expect } from "@playwright/test";

test("the layered image responds to the pointer and motion can be paused", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const scene = page.getByRole("figure", { name: "Plant care illustration" });
  const toggle = scene.getByRole("button", { name: "Image motion", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const photo = scene.getByRole("img");
  const transform = () => photo.evaluate((image) => getComputedStyle(image).transform);
  const initial = await transform();
  const box = (await scene.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.25);
  await expect.poll(transform).not.toBe(initial);
  await page.screenshot({ path: testInfo.outputPath("layered-image.png"), animations: "disabled" });

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(transform).toBe("none");
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.75);
  await expect.poll(transform).toBe("none");
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
});

test("mobile scrolling moves the image without blocking page scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const scene = page.getByRole("figure", { name: "Plant care illustration" });
  await scene.scrollIntoViewIfNeeded();
  const photo = scene.getByRole("img");
  const transform = () => photo.evaluate((image) => getComputedStyle(image).transform);
  const before = await transform();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => window.scrollBy({ top: 120, behavior: "instant" }));
  await expect.poll(transform).not.toBe(before);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("reduced motion disables image movement, including preference changes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const scene = page.getByRole("figure", { name: "Plant care illustration" });
  const toggle = scene.getByRole("button", { name: "Image motion", exact: true });
  const photo = scene.getByRole("img");
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await photo.evaluate((image) => getComputedStyle(image).transform)).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(toggle).toBeDisabled();
  expect(await photo.evaluate((image) => getComputedStyle(image).transform)).toBe("none");
});
