// The phone view's service worker (ticket 35): opens /floor without a connection.
// Pages: network first, the last copy when offline. Built assets: cache first.
const CACHE = "hs-floor-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.open(CACHE).then(async (c) => (await c.match(req)) ?? fetch(req).then((res) => (res.ok && c.put(req, res.clone()), res))));
    return;
  }
  if (req.mode === "navigate" && url.pathname === "/floor") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit ?? Response.error())),
    );
  }
});
