// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const origin = "https://citruscare.net";
const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

type WorkerEvent = {
  request?: Request;
  waitUntil: (promise: Promise<unknown>) => void;
  respondWith: (promise: Promise<Response>) => void;
};

function createWorker() {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: Request | string) =>
    new URL(typeof request === "string" ? request : request.url, origin).href;
  const fetch = vi.fn(async (request: Request | string) => {
    const path = new URL(key(request)).pathname;
    return new Response("Initial " + path, {
      status: ["/login", "/signup"].includes(path) ? 404 : 200,
    });
  });
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        async match(request: Request | string) {
          return store.get(key(request))?.clone();
        },
        async put(request: Request | string, response: Response) {
          store.set(key(request), response.clone());
        },
        async addAll(paths: string[]) {
          const entries = await Promise.all(paths.map(async (path) => {
            const response = await fetch(path);
            if (!response.ok) throw new TypeError("Failed to cache " + path);
            return [key(path), response] as const;
          }));
          for (const [url, response] of entries) store.set(url, response.clone());
        },
      };
    },
    async match(request: Request | string) {
      for (const store of stores.values()) {
        const response = store.get(key(request));
        if (response) return response.clone();
      }
    },
    async keys() { return [...stores.keys()]; },
    async delete(name: string) { return stores.delete(name); },
  };
  runInNewContext(source, {
    self: {
      location: { origin },
      addEventListener: (type: string, listener: (event: WorkerEvent) => void) =>
        listeners.set(type, listener),
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined },
    },
    caches,
    fetch,
    URL,
    Response,
  });

  async function dispatch(type: string, request?: Request) {
    const pending: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    listeners.get(type)!({
      request,
      waitUntil: (promise) => { pending.push(promise); },
      respondWith: (promise) => { response = promise; },
    });
    const result = await response;
    await Promise.all(pending);
    return result;
  }

  return { caches, fetch, dispatch };
}

function navigation(path: string) {
  const request = new Request(new URL(path, origin));
  // Node's Request constructor does not accept the browser-only navigate mode.
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
}

async function installedWorker() {
  const worker = createWorker();
  await worker.dispatch("install");
  const [cacheName] = await worker.caches.keys();
  const cache = await worker.caches.open(cacheName);
  worker.fetch.mockClear();
  return { ...worker, cache, cacheName };
}

describe("production service worker", () => {
  it("installs the shell without requesting removed account pages", async () => {
    const worker = createWorker();
    await worker.dispatch("install");
    expect(await worker.caches.match("/")).toBeDefined();
    expect(worker.fetch.mock.calls.map(([request]) => String(request))).not.toEqual(
      expect.arrayContaining(["/login", "/signup"]),
    );
  });

  it("serves a fresh navigation and replaces the older cached document", async () => {
    const worker = await installedWorker();
    await worker.cache.put("/", new Response("Old landing page"));
    worker.fetch.mockResolvedValue(new Response("Updated landing page"));

    const response = await worker.dispatch("fetch", navigation("/"));

    expect(await response?.text()).toBe("Updated landing page");
    expect(await (await worker.cache.match("/"))?.text()).toBe("Updated landing page");
    expect(worker.fetch).toHaveBeenCalledOnce();
  });

  it("falls back to the matching cached document when offline", async () => {
    const worker = await installedWorker();
    await worker.cache.put("/guides", new Response("Cached guides"));
    worker.fetch.mockRejectedValue(new TypeError("Network unavailable"));

    const response = await worker.dispatch("fetch", navigation("/guides"));

    expect(await response?.text()).toBe("Cached guides");
    await expect(worker.dispatch("fetch", navigation("/uncached"))).rejects.toThrow("Network unavailable");
  });

  it.each([404, 500])("does not cache a %i response over a valid document", async (status) => {
    const worker = await installedWorker();
    await worker.cache.put("/", new Response("Cached landing page"));
    worker.fetch.mockResolvedValue(new Response("Error", { status }));

    const response = await worker.dispatch("fetch", navigation("/"));

    expect(response?.status).toBe(status);
    expect(await (await worker.cache.match("/"))?.text()).toBe("Cached landing page");
  });

  it.each(["/", "/?_rsc=abc", "/guides?_rsc=abc"])(
    "leaves non-navigation and RSC requests to %s alone",
    async (path) => {
      const worker = await installedWorker();
      const request = new Request(new URL(path, origin), { headers: { RSC: "1" } });

      expect(await worker.dispatch("fetch", request)).toBeUndefined();
      expect(worker.fetch).not.toHaveBeenCalled();
    },
  );

  it("removes old Citrus shell caches while preserving unrelated caches", async () => {
    const worker = await installedWorker();
    await worker.caches.open("citrus-shell-v1");
    await worker.caches.open("other-application-cache");

    await worker.dispatch("activate");

    expect(await worker.caches.keys()).toEqual([
      worker.cacheName,
      "other-application-cache",
    ]);
    expect(await worker.caches.keys()).not.toContain("citrus-shell-v1");
  });

  it("reuses immutable Next static assets from the current cache", async () => {
    const worker = await installedWorker();
    const path = "/_next/static/chunks/abc123.js";
    await worker.cache.put(path, new Response("Cached immutable chunk"));

    const response = await worker.dispatch("fetch", new Request(new URL(path, origin)));

    expect(await response?.text()).toBe("Cached immutable chunk");
    expect(worker.fetch).not.toHaveBeenCalled();
  });
});
