/*
 * LibreCorsa Offline — Cache-First Service Worker (base template).
 * During `npm run build`, scripts/generate-offline-sw.mjs replaces out/sw.js
 * with the full build-hashed precache manifest so the entire simulator runs
 * 100% offline in any modern browser or installed PWA.
 */

const CACHE_NAME = "librecorsa-offline-dev";
const PRECACHE_URLS = [];
const CLEAN_ROUTES = {
  "/": "/index.html",
  "/play": "/play.html",
  "/about": "/about.html",
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      if (PRECACHE_URLS.length > 0) {
        const cache = await caches.open(CACHE_NAME);
        const batchSize = 8;
        for (let i = 0; i < PRECACHE_URLS.length; i += batchSize) {
          const slice = PRECACHE_URLS.slice(i, i + batchSize);
          await Promise.all(
            slice.map(async (url) => {
              try {
                const req = new Request(url, { cache: "reload", credentials: "same-origin" });
                const res = await fetch(req);
                if (res.ok && res.type === "basic") await cache.put(url, res);
              } catch {
                // Best-effort precache; runtime Cache-First still catches misses.
              }
            }),
          );
        }
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE_NAME) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

async function matchFromCache(cache, pathname) {
  const direct = await cache.match(pathname, { ignoreSearch: true });
  if (direct) return direct;
  const trimmed = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const mapped = CLEAN_ROUTES[trimmed];
  if (mapped) {
    const byRoute = await cache.match(mapped, { ignoreSearch: true });
    if (byRoute) return byRoute;
  }
  if (!trimmed.endsWith(".html")) {
    const html = await cache.match(`${trimmed}.html`, { ignoreSearch: true });
    if (html) return html;
    const indexHtml = await cache.match(`${trimmed}/index.html`, { ignoreSearch: true });
    if (indexHtml) return indexHtml;
  }
  return undefined;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await matchFromCache(cache, url.pathname);
      if (cached) return cached;

      try {
        const res = await fetch(req);
        if (res.ok && res.type === "basic") {
          void cache.put(url.pathname, res.clone());
        }
        return res;
      } catch {
        if (req.mode === "navigate") {
          const fallback = (await matchFromCache(cache, "/play")) || (await matchFromCache(cache, "/"));
          if (fallback) return fallback;
        }
        return new Response("Offline asset unavailable", { status: 503, statusText: "Offline" });
      }
    })(),
  );
});
