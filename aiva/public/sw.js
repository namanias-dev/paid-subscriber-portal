/**
 * AIVA service worker — minimal, private, offline-friendly shell.
 * Network-first for navigation and API (never cache private data long-term);
 * cache-first only for static build assets. No push, no background sync in v1.
 */
const STATIC_CACHE = "aiva-static-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache API or auth — always go to network.
  if (url.pathname.startsWith("/api/")) return;

  // Static Next assets: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.endsWith(".svg") || url.pathname.endsWith(".png")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  // Navigations: network-first, no stale private data.
});
