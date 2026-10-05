/**
 * MallMind Service Worker (Sprint 8 pilot hardening)
 *
 * - Build assets are PRECACHED at install from a manifest the build injects (see the `mallmindSw`
 *   plugin in vite.config.ts): the app shell, every /assets/* chunk (including the lazy Navigate
 *   chunk that holds the bundled Venue Packs), the manifest and icons. A venue opened once is then
 *   available offline on the SAME browser context, including a cold open of a QR link.
 * - Navigations: network-first with the cached shell as offline fallback (SPA fallback for /navigate).
 * - /assets/*: cache-first; an offline miss returns an honest 503 instead of throwing.
 * - Other same-origin GETs: stale-while-revalidate. Cross-origin (Supabase, Cloud Run, fonts): never
 *   intercepted.
 * - Updates: a new worker WAITS; the page shows "update ready" and the visitor chooses when to
 *   reload (never mid-walk without consent). Old caches are deleted on activation.
 *
 * The placeholders below are replaced at build time; in `vite dev` they stay inert.
 */

const BUILD_ID = "__BUILD_ID__";
const PRECACHE_ASSETS = /*__PRECACHE__*/[];

const CACHE_VERSION = BUILD_ID.startsWith("__") ? "mallmind-dev" : `mallmind-${BUILD_ID}`;
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const KNOWN_CACHES = new Set([SHELL_CACHE, ASSET_CACHE, RUNTIME_CACHE]);

const OFFLINE_SHELL = "/index.html";
const SHELL_URLS = ["/", OFFLINE_SHELL, "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

/** Cache each URL independently: one missing file must not abort the whole precache. */
async function precache(cacheName, urls) {
  const cache = await caches.open(cacheName);
  await Promise.allSettled(urls.map(async (u) => {
    try { const r = await fetch(u, { cache: "no-cache" }); if (r && r.ok) await cache.put(u, r); } catch { /* skip */ }
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await precache(SHELL_CACHE, SHELL_URLS);
    await precache(ASSET_CACHE, PRECACHE_ASSETS);
    // No skipWaiting here: the page decides when the new version takes over (see main.tsx).
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !KNOWN_CACHES.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "GET_BUILD_ID" && event.source) event.source.postMessage({ type: "BUILD_ID", buildId: BUILD_ID });
});

function isNavigation(request) {
  return request.mode === "navigate" ||
    (request.method === "GET" && (request.headers.get("accept") || "").includes("text/html"));
}

async function networkFirstShell(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(OFFLINE_SHELL, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(OFFLINE_SHELL);
    if (cached) return cached;
    return new Response("You are offline and MallMind has not been saved on this phone yet. Connect once, then it works offline.", {
      status: 503, headers: { "Content-Type": "text/plain" },
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("", { status: 503, statusText: "offline-asset-missing" });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refresh = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => undefined);
  return cached || (await refresh) || new Response("", { status: 504 });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isNavigation(request)) { event.respondWith(networkFirstShell(request)); return; }
  if (url.pathname.startsWith("/assets/")) { event.respondWith(cacheFirst(request, ASSET_CACHE)); return; }
  if (url.pathname === "/sw.js") return;
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

// ── Web Push ──────────────────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  let payload = { title: "MallMind", body: "Price drop alert!", url: "/deals" };
  try { if (event.data) payload = { ...payload, ...event.data.json() }; } catch { if (event.data) payload.body = event.data.text(); }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: "price-drop", renotify: true,
    data: { url: payload.url }, actions: [{ action: "view", title: "View Deal" }, { action: "dismiss", title: "Dismiss" }],
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;
  const targetUrl = event.notification.data?.url ?? "/deals";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) { if (client.url.includes(self.location.origin)) { client.focus(); client.navigate(targetUrl); return; } }
    return self.clients.openWindow(targetUrl);
  }));
});
