import { expect, test } from "@playwright/test";

const mediaPath = "/media/citrus-care-tutorial-v1.mp4";
const videoLabel = "Citrus Care app tutorial";

test("tutorial is discoverable without downloading the recording before Play", async ({ page }, testInfo) => {
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(mediaPath)) mediaRequests.push(request.url());
  });
  await page.goto("/#how-it-works");
  await expect(page.getByRole("heading", { name: "Watch how to use Citrus Care" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play tutorial" })).toBeEnabled();
  const video = page.getByLabel(videoLabel);
  await expect(video).not.toHaveAttribute("src");
  await expect(video).not.toHaveAttribute("autoplay");
  await expect(video).toHaveAttribute("preload", "none");
  expect(mediaRequests).toEqual([]);
  await expect(page.getByRole("link", { name: "Download video" })).toHaveAttribute("href", mediaPath);
  await expect(page.getByRole("heading", { name: "Follow the recording" })).toBeVisible();
  await page.locator("#how-it-works").screenshot({ path: testInfo.outputPath("tutorial-desktop.png") });
});

test("keyboard starts the real recording; native playback, seeking and subtitles work", async ({ page }) => {
  await page.goto("/#how-it-works");
  const play = page.getByRole("button", { name: "Play tutorial" });
  await expect(play).toBeEnabled();
  await play.focus();
  await page.keyboard.press("Enter");
  const video = page.getByLabel(videoLabel);
  await expect(video).toBeFocused();
  await expect(video).toHaveAttribute("controls", "");
  await expect(video).toHaveAttribute("src", mediaPath);
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime), { timeout: 20000 }).toBeGreaterThan(0.2);
  const duration = await video.evaluate((node: HTMLVideoElement) => node.duration);
  expect(duration).toBeGreaterThan(62);
  expect(duration).toBeLessThan(63);
  await video.evaluate((node: HTMLVideoElement) => node.pause());
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
  await video.evaluate((node: HTMLVideoElement) => { node.currentTime = 48; });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => !node.seeking && node.currentTime >= 48)).toBe(true);
  await video.evaluate((node: HTMLVideoElement) => node.play());
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(48.2);
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.textTracks[0]?.cues?.length ?? 0)).toBeGreaterThan(5);
  await expect(video.locator("track")).toHaveAttribute("label", "English — on-screen steps");
  await expect(page.getByRole("status")).not.toBeVisible();
});

test("video supports byte ranges and versioned media caching", async ({ request }) => {
  const response = await request.get(mediaPath, { headers: { Range: "bytes=0-1023" } });
  expect(response.status()).toBe(206);
  expect(response.headers()["content-type"]).toMatch(/^video\/mp4/);
  expect(response.headers()["accept-ranges"]).toBe("bytes");
  expect(response.headers()["content-range"]).toMatch(/^bytes 0-1023\/\d+$/);
  expect((await response.body()).length).toBe(1024);
  expect(response.headers()["cache-control"]).toContain("max-age=31536000");
  expect(response.headers()["cache-control"]).toContain("immutable");
  for (const range of ["bytes=4000000-4001023", "bytes=-1024"]) {
    const seek = await request.get(mediaPath, { headers: { Range: range } });
    expect(seek.status()).toBe(206);
    expect((await seek.body()).length).toBe(1024);
  }
  const invalid = await request.get(mediaPath, { headers: { Range: "bytes=999999999-" } });
  // Next 16.2.9 returns 416 in dev but renders this as 500 in production.
  // Reproduced on the pre-existing live manifest too; never serve the full clip.
  expect([416, 500]).toContain(invalid.status());
  expect(invalid.headers()["content-range"]).toMatch(/^bytes \*\/\d+$/);
  expect((await invalid.body()).length).toBeLessThan(1024);
  const poster = await request.head("/media/citrus-care-tutorial-v1.webp");
  expect(poster.status()).toBe(200);
  expect(poster.headers()["content-type"]).toMatch(/^image\/webp/);
  const steps = await request.get("/media/citrus-care-tutorial-v1.vtt");
  expect(steps.status()).toBe(200);
  expect(steps.headers()["content-type"]).toMatch(/^text\/vtt/);
  expect(await steps.text()).toMatch(/^WEBVTT/);
});

test("a failed video request keeps an honest download fallback", async ({ page }) => {
  await page.route(`**${mediaPath}`, (route) => route.abort());
  await page.goto("/#how-it-works");
  await page.getByRole("button", { name: "Play tutorial" }).click();
  await expect(page.getByRole("status")).toContainText(/couldn.t (load|start) the video/i);
  await expect(page.getByRole("link", { name: "Download video" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download video" })).toHaveAttribute("href", mediaPath);
});

test("tutorial and written steps fit a narrow screen with enlarged text", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/#how-it-works");
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  const play = page.getByRole("button", { name: "Play tutorial" });
  await play.scrollIntoViewIfNeeded();
  const box = await play.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeLessThan(240);
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("heading", { name: "Follow the recording" })).toBeVisible();
  await page.getByRole("heading", { name: "Follow the recording" }).click();
  await expect(page.getByText("0:00 — Add a plant.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await play.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("tutorial-mobile-dark-large-text.png") });
});

test("without JavaScript the recording download and written steps remain usable", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  try {
    await page.goto("/#how-it-works");
    await expect(page.getByRole("button", { name: "Play tutorial" })).toBeDisabled();
    // Playwright's text engine intentionally skips noscript contents.
    await expect(page.locator("noscript p")).toHaveText("Use Download video below to watch without JavaScript.");
    await expect(page.locator("noscript p")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download video" })).toHaveAttribute("download", "citrus-care-tutorial-v1.mp4");
    await expect(page.getByRole("heading", { name: "Follow the recording" })).toBeVisible();
    await expect(page.getByLabel(videoLabel)).not.toHaveAttribute("src");
    // Use the native keyboard path, without a JS-dependent stability wait
    // during the browser's initial fragment scroll.
    await page.locator("summary").filter({ hasText: "Follow the recording" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("0:00 — Add a plant.")).toBeVisible();
    await page.getByRole("link", { name: "Download video" }).focus();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.keyboard.press("Enter"),
    ]);
    expect(download.suggestedFilename()).toBe("citrus-care-tutorial-v1.mp4");
    expect(await download.failure()).toBeNull();
  } finally {
    await context.close();
  }
});
