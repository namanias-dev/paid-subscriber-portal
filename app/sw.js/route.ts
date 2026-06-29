import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Root-scoped service worker, served fresh each deploy (build id baked in, never
 * cached). Its ONLY job is cache hygiene: on activate it takes control of all
 * tabs and deletes every CacheStorage entry, so a returning device can never be
 * pinned to an old cached bundle. It has NO fetch handler, so it never serves
 * cached content itself — it can only ever help purge, never cause staleness.
 */
export async function GET() {
  const build = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
  const body = `// Naman IAS cache-purge service worker — build ${build}
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) { /* ignore */ }
    try { await self.clients.claim(); } catch (e) { /* ignore */ }
  })());
});
// Intentionally NO fetch handler: this worker never serves cached responses.
`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Service-Worker-Allowed": "/",
    },
  });
}
