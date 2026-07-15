import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { loadLocalEnv } from "./env";
import assess from "./routes/assess";
import cleanupOrphans from "./routes/cleanup-orphans";

loadLocalEnv();

const app = new Hono();

// Permissive CORS for direct (Bearer-auth) callers such as the mobile app.
// credentials: false — cookie auth only flows same-origin via Next rewrites.
app.use("*", cors({ origin: "*", credentials: false }));

app.onError((err, c) => {
  console.error("[api] Unhandled error:", err.message);
  return c.json({ error: "Internal server error" }, 500);
});

app.get("/health", (c) => c.json({ ok: true }));
app.route("/assess", assess);
app.route("/cleanup-orphans", cleanupOrphans);

export default app;

// Vitest exercises the app via app.request(); only bind a port outside tests.
if (!process.env.VITEST) {
  const port = Number(process.env.PORT ?? 3003);
  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
    console.log(`[api] listening on http://localhost:${info.port}`);
  });
}
