import { expect, test } from "@playwright/test";

// Phase 6d — the Garden Walk labelling guide: a static, sourced page that the
// guides index links to, with the same return links as the pruning guides.
const guideTitle = "Labeling your trees so photos land on the right plant";

test("the guides index links to the labeling guide, which renders its title and a way back", async ({ page }) => {
  await page.goto("/guides");
  await page.getByRole("link", { name: /labeling your trees/i }).click();
  await expect(page).toHaveURL(/\/guides\/labeling-trees$/);
  await expect(page.getByRole("heading", { level: 1, name: guideTitle })).toBeVisible();

  // Every section the research doc feeds is present, and the claims carry their sources.
  for (const name of [/the number is the identity/i, /what lasts outdoors/i, /where and how to mount/i, /codes/i, /sources/i]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  const sources = page.getByRole("list", { name: "Sources", exact: true });
  await expect(sources.getByRole("link", { name: /bartlett/i })).toHaveAttribute("href", /bartlett\.com/);
  await expect(sources.getByRole("link", { name: /plant inventory operations manual/i })).toHaveAttribute("href", /arboretum\.harvard\.edu/);
  await expect(sources.getByRole("link", { name: /UC ANR/i })).toHaveAttribute("href", /ucanr\.edu/);
  await expect(sources.getByRole("link", { name: /national band/i })).toHaveAttribute("href", /nationalband\.com/);

  const navigation = page.getByRole("navigation", { name: "Guide navigation", exact: true });
  const back = navigation.getByRole("link", { name: "Back to all guides", exact: true });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/guides$/);
  await expect(page.getByRole("heading", { name: /when — and where — to prune/i })).toBeVisible();
});

test("the labeling guide reads without JavaScript on a narrow screen with tappable return links", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 740 },
  });
  try {
    const page = await context.newPage();
    await page.goto("/guides/labeling-trees");
    await expect(page.getByRole("heading", { level: 1, name: guideTitle })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

    for (const name of ["Guide navigation", "Continue exploring"]) {
      const navigation = page.getByRole("navigation", { name, exact: true });
      await navigation.scrollIntoViewIfNeeded();
      for (const link of await navigation.getByRole("link").all()) {
        const target = (await link.boundingBox())!;
        expect(target.height).toBeGreaterThanOrEqual(44);
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.x).toBeGreaterThanOrEqual(0);
        expect(target.x + target.width).toBeLessThanOrEqual(320);
      }
    }
    await page.getByRole("navigation", { name: "Continue exploring", exact: true })
      .getByRole("link", { name: "Back to home", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  } finally {
    await context.close();
  }
});
