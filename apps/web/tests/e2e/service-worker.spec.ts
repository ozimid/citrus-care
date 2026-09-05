import { test, expect } from "@playwright/test";

test("production refreshes cached pages and retains an offline copy", async ({ page, context }) => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Service workers register in production only.");
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
      });
    }
  });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Plant care,");
  // Reproduce a returning browser with an obsolete document in its app cache.
  await page.evaluate(async () => {
    const names = await caches.keys();
    const name = names.find((key) => key.startsWith("citrus-shell-"));
    if (!name) throw new Error("No application cache was created");
    const cache = await caches.open(name);
    await cache.put(new URL("/", location.origin).href, new Response("<h1>Old cached landing</h1>", {
      headers: { "Content-Type": "text/html" },
    }));
  });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Plant care,");
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Plant care,");
  await expect(page.getByRole("link", { name: /download the apk/i })).toHaveAttribute("href", /releases\/latest\/download\/citrus-care.apk$/);
});
