import { expect, test } from "@playwright/test";

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
