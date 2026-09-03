/**
 * MallMind Service Worker
 * - App shell: NETWORK-FIRST for navigations (index.html) with an offline
 *   fallback to the cached shell, so a deploy reaches installed users on the
 *   next open instead of being pinned to a stale shell forever.
 * - Hashed build assets (/assets/*): cache-first (content-addressed, immutable).
 * - Other same-origin GETs (manifest, icons, sw-adjacent files): stale-while-revalidate.
 * - Cross-origin requests (Supabase, Cloud Run API, fonts): never intercepted.
 * - Handles Web Push notifications for price drop alerts.
 *
 * CACHE_VERSION must change whenever caching behaviour changes; the activate
 * step deletes every cache that does not match the current version.
 */

const CACHE_VERSION = "mallmind-v3-2026-09-03";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const KNOWN_CACHES = new Set([SHELL_CACHE, ASSET_CACHE, RUNTIME_CACHE]);

const OFFLINE_SHELL = "/index.html";
const PRECACHE_URLS = ["/", OFFLINE_SHELL, "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !KNOWN_CACHES.has(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
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
    return new Response("You are offline and MallMind has not been cached yet.", {
      status: 503, headers: { "Content-Type": "text/plain" },
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
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
  // Never intercept cross-origin traffic (Supabase, the Cloud Run API, fonts).
  if (url.origin !== self.location.origin) return;

  if (isNavigation(request)) {
    event.respondWith(networkFirstShell(request));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }
  if (url.pathname === "/sw.js") return; // the browser manages the worker itself
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

// ── Web Push ──────────────────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  let payload = { title: "MallMind", body: "Price drop alert!", url: "/deals" };

  try {
    if (event.data) {
      const data = event.data.json();
      payload = { ...payload, ...data };
    }
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "price-drop",          // replaces any existing price-drop notification
      renotify: true,
      data: { url: payload.url },
      actions: [
        { action: "view", title: "View Deal" },
        { action: "dismiss", title: "Dismiss" },
      ],
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url ?? "/deals";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus existing tab if open
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      // Otherwise open a new tab
      return self.clients.openWindow(targetUrl);
    })
  );
});
