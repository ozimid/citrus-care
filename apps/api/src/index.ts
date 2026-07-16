import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { loadLocalEnv } from "./env";
import assess from "./routes/assess";
import careProfile from "./routes/care-profile";

loadLocalEnv();

const app = new Hono();

// Permissive CORS for direct (Bearer-auth) callers such as the mobile app.
// credentials: false — cookie auth only flows same-origin via Next rewrites.
app.use("*", cors({ origin: "*", credentials: false }));

// Reject oversized bodies before they are buffered (the in-schema 3MB image
// cap runs post-parse; without this an unauthenticated request could
// materialize an arbitrarily large JSON string in memory first).
// 3MB image * 4/3 base64 + JSON envelope headroom.
app.use("*", bodyLimit({ maxSize: 4_400_000 }));

app.onError((err, c) => {
  console.error("[api] Unhandled error:", err.message);
  return c.json({ error: "Internal server error" }, 500);
});

app.get("/health", (c) => c.json({ ok: true }));
app.route("/assess", assess);
app.route("/care-profile", careProfile);

export default app;

// Vitest exercises the app via app.request(); only bind a port outside tests.
if (!process.env.VITEST) {
  // API_PORT (namespaced) wins: a bare PORT in the environment often belongs
  // to a sibling process (e.g. the web dev server's harness) — binding it
  // here steals the web app's port.
  const port = Number(process.env.API_PORT ?? 3003);
  // vite-node --watch re-executes this module on file changes without closing
  // the previous listener, which then EADDRINUSEs its own zombie. Close the
  // prior server (stashed on globalThis) before binding again.
  const g = globalThis as { __citrusApiServer?: { close: (cb?: () => void) => void } };
  g.__citrusApiServer?.close();
  g.__citrusApiServer = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
    console.log(`[api] listening on http://localhost:${info.port}`);
  });
}
