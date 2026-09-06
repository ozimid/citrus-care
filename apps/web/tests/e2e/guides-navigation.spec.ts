import { expect, test, type Page } from "@playwright/test";

const apkDownloadUrl = "https://github.com/ozimid/citrus-care/releases/latest/download/citrus-care.apk";
const guideRoutes = [
  "/guides",
  "/guides/citrus-tree",
  "/guides/roses",
  "/guides/flowering-shrubs",
  "/guides/trees-and-shrubs",
];

async function expectDirectApkDownload(page: Page, route: string) {
  // Exercise the browser's real download behavior with a small attachment,
  // without fetching the production APK for every guide regression check.
  await page.route(apkDownloadUrl, (request) => request.fulfill({
    status: 200,
    contentType: "application/vnd.android.package-archive",
    headers: { "Content-Disposition": "attachment; filename=\"citrus-care.apk\"" },
    body: "Citrus Care APK download regression fixture",
  }));
  await page.goto(route);
  const guideUrl = page.url();
  const downloadLink = page.getByRole("link", { name: "Download for Android", exact: true });
  await expect(downloadLink).toHaveAttribute("href", apkDownloadUrl);
  await downloadLink.scrollIntoViewIfNeeded();
  const target = (await downloadLink.boundingBox())!;
  expect(target.height).toBeGreaterThanOrEqual(44);
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.x).toBeGreaterThanOrEqual(0);
  expect(target.x + target.width).toBeLessThanOrEqual(320);

  if (route === "/guides") await downloadLink.focus();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    route === "/guides" ? page.keyboard.press("Enter") : downloadLink.click(),
  ]);
  expect(download.url()).toBe(apkDownloadUrl);
  expect(download.suggestedFilename()).toBe("citrus-care.apk");
  expect(await download.failure()).toBeNull();
  await expect(page).toHaveURL(guideUrl);
  await page.getByRole("link", { name: "Installation instructions", exact: true }).click();
  await expect(page).toHaveURL(/\/#get-the-app$/);
  await expect(page.getByRole("heading", { name: "Get the app", exact: true })).toBeInViewport();
}

for (const route of guideRoutes) {
  test(`Download for Android downloads the APK directly from ${route}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await expectDirectApkDownload(page, route);
  });
}

test("guide APK downloads work without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 740 },
  });
  try {
    const page = await context.newPage();
    for (const route of ["/guides", "/guides/citrus-tree"]) {
      await expectDirectApkDownload(page, route);
    }
  } finally {
    await context.close();
  }
});

test("pruning guides provide a keyboard-accessible route back to the home page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "The pruning guides are free on this site" }).click();
  await expect(page).toHaveURL(/\/guides$/);

  const navigation = page.getByRole("navigation", { name: "Guide navigation", exact: true });
  await expect(navigation.getByRole("link", { name: "Back to home", exact: true })).toBeInViewport();
  await page.getByRole("link", { name: /how to prune a citrus tree/i }).click();
  await expect(page).toHaveURL(/\/guides\/citrus-tree$/);

  const allGuides = navigation.getByRole("link", { name: "Back to all guides", exact: true });
  await expect(allGuides).toBeInViewport();
  await allGuides.focus();
  await expect(allGuides).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/guides$/);
  await navigation.getByRole("link", { name: "Back to home", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Plant care,");
});

test("direct guide links have an escape without JavaScript or prior site history", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/guides/roses");
  const navigation = page.getByRole("navigation", { name: "Guide navigation", exact: true });
  await navigation.getByRole("link", { name: "Back to all guides", exact: true }).click();
  await expect(page).toHaveURL(/\/guides$/);
  await navigation.getByRole("link", { name: "Back to home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/guides/trees-and-shrubs");
  const returnNavigation = page.getByRole("navigation", { name: "Continue exploring", exact: true });
  await returnNavigation.getByRole("link", { name: "Back to all guides", exact: true }).click();
  await expect(page).toHaveURL(/\/guides$/);
  await returnNavigation.getByRole("link", { name: "Back to home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/guides/flowering-shrubs");
  await navigation.getByRole("link", { name: "Back to home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await context.close();
});

test("guide return links fit a narrow screen and remain easy to tap in dark mode", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ colorScheme: "dark" });

  for (const route of ["/guides", "/guides/citrus-tree"]) {
    await page.goto(route);
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

    for (const name of ["Guide navigation", "Continue exploring"]) {
      const navigation = page.getByRole("navigation", { name, exact: true });
      if (name === "Continue exploring") await navigation.scrollIntoViewIfNeeded();
      for (const link of await navigation.getByRole("link").all()) {
        await expect(link).toBeInViewport();
        const target = await link.boundingBox();
        expect(target!.height).toBeGreaterThanOrEqual(44);
        expect(target!.width).toBeGreaterThanOrEqual(44);
        expect(target!.x).toBeGreaterThanOrEqual(0);
        expect(target!.x + target!.width).toBeLessThanOrEqual(320);
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`${route === "/guides" ? "index" : "detail"}-dark-mobile.png`), fullPage: true });
  }
});
