/* ===== Service worker: precache + stale-while-revalidate =====
   Навигация берётся из сети с фолбэком в кэш (офлайн),
   статика отдаётся мгновенно из кэша и дообновляется в фоне —
   поэтому ручная смена версии кэша больше не обязательна. */

const CACHE_VERSION = "box-breathing-v10";
const OFFLINE_PAGE = "./index.html";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
];

const OPTIONAL_ASSETS = [
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "./sounds/phase.wav",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Ядро обязательно; опциональные ассеты не должны ронять установку целиком.
      await cache.addAll(CORE_ASSETS);
      await Promise.all(
        OPTIONAL_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn("[sw] не закэшировано:", url, err))
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

async function networkFirst(event, request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone()).catch(() => {});
    return fresh;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const fallback = await cache.match(OFFLINE_PAGE);
      if (fallback) return fallback;
    }
    throw e;
  }
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  const revalidate = (async () => {
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok) await cache.put(request, fresh.clone());
      return fresh;
    } catch (e) {
      return null; // офлайн — остаёмся на кэше
    }
  })();

  if (cached) {
    event.waitUntil(revalidate);
    return cached;
  }

  const fresh = await revalidate;
  if (fresh && fresh.ok) return fresh;
  return Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    request.mode === "navigate"
      ? networkFirst(event, request)
      : staleWhileRevalidate(event, request)
  );
});
