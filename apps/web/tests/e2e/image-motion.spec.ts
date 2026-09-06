import { test, expect } from "@playwright/test";

test("the full-screen image responds from either side without moving the content", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const scene = page.getByRole("region", { name: "Plant care introduction" });
  const toggle = scene.getByRole("button", { name: "Image motion", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const photo = scene.getByRole("img");
  const transform = () => photo.evaluate((image) => getComputedStyle(image).transform);
  const initial = await transform();
  const box = (await scene.boundingBox())!;
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveCSS("animation-name", "none");
  const headingBox = await heading.boundingBox();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.25);
  await expect.poll(transform).not.toBe(initial);
  const fromLeft = await transform();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.25);
  await expect.poll(transform).not.toBe(fromLeft);
  expect(await heading.boundingBox()).toEqual(headingBox);
  await page.screenshot({ path: testInfo.outputPath("full-screen-hero.png"), animations: "disabled" });

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(transform).toBe("none");
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.75);
  await expect.poll(transform).toBe("none");
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
});

test("the photo fills the opening screen and the demo follows below it", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const scene = page.getByRole("region", { name: "Plant care introduction" });
    const bounds = (await scene.boundingBox())!;
    const photo = (await scene.getByRole("img").boundingBox())!;
    expect(bounds.x).toBe(0);
    expect(bounds.width).toBe(width);
    expect(bounds.height).toBeGreaterThanOrEqual(900);
    expect(photo).toEqual(bounds);
    await expect(scene.getByRole("tablist")).toHaveCount(0);
    const demo = (await page.getByRole("tablist").boundingBox())!;
    expect(demo.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
    const toggle = (await scene.getByRole("button", { name: "Image motion", exact: true }).boundingBox())!;
    expect(toggle.width).toBeGreaterThanOrEqual(44);
    expect(toggle.height).toBeGreaterThanOrEqual(44);
  }
});

test("mobile scrolling moves the image without blocking page scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const scene = page.getByRole("region", { name: "Plant care introduction" });
  await expect(scene).toHaveAttribute("data-motion", "on");
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
  const scene = page.getByRole("region", { name: "Plant care introduction" });
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
