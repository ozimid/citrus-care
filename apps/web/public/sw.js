// Citrus Care — fresh pages online, previously visited pages offline.
// Only documents, the manifest, and immutable Next assets are cached.
// Tutorial media uses the browser's HTTP cache and native byte-range requests.

const CACHE_PREFIX = "citrus-shell-";
const CACHE = `${CACHE_PREFIX}v3`;
const SHELL = ["/", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => null)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function cachedResponse(request) {
  return caches.open(CACHE)
    .then((cache) => cache.match(request))
    .catch(() => undefined);
}

async function fetchAndCache(request) {
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    // Storage failures must not prevent a successful network response.
    await caches.open(CACHE)
      .then((cache) => cache.put(request, copy))
      .catch(() => null);
  }
  return response;
}

async function networkFirst(request) {
  try {
    return await fetchAndCache(request);
  } catch (error) {
    const cached = await cachedResponse(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Opening a video URL directly is also a navigation. Keep media out of the
  // shell cache and let the browser handle streaming and seeking itself.
  if (url.pathname.startsWith("/media/")) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/data")) return;

  if (req.mode === "navigate" || url.pathname === "/manifest.json") {
    // App Router RSC/prefetch requests are not document navigations.
    event.respondWith(networkFirst(req));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      cachedResponse(req).then((cached) => cached || fetchAndCache(req)),
    );
  }
});
