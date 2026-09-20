import { chromium } from "@playwright/test";
const SD = process.env.SD;
const b = await chromium.launch();
const ctx = await b.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto("http://localhost:3002/guides/labeling-trees", { waitUntil: "load" });
await p.addStyleTag({ content: '[class*="bg-amber"],[class*="border-amber"]{display:none!important}' }).catch(()=>{});
const h2 = await p.evaluate(() => [...document.querySelectorAll("h2")].map(h => ({ t: h.textContent, y: Math.round(h.getBoundingClientRect().top + window.scrollY) })));
console.log(JSON.stringify(h2));
for (const [i, y] of [["numberIdentity", h2[0].y], ["mount", h2[2].y], ["codes", h2[3].y]]) {
  await p.evaluate((yy) => window.scrollTo(0, yy - 8), y);
  await p.screenshot({ path: `${SD}/guide-${i}.png` });
}
await b.close();
