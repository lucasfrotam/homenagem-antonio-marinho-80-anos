/* Service worker leve: shell + capa (+ fontes/letra em runtime) */
const CACHE = "homenagem-antonio-v8";
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/fonts.css",
  "./assets/lyrics.json?v=3",
  "./assets/favicon.svg",
  "./assets/favicon.png",
  "./assets/apple-touch-icon.png",
  "./assets/capa.jpg",
  "./assets/capa-512.jpg",
  "./assets/og-cover.jpg",
  "./assets/antonio-portrait.jpg",
  "./assets/letra.vtt",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Áudio: network-first (não inchamos o precache)
  const isAudio =
    url.pathname.endsWith(".m4a") ||
    url.pathname.endsWith(".mp3") ||
    url.pathname.endsWith(".vtt");

  if (isAudio) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (
            res.ok &&
            (url.pathname.includes("/assets/") ||
              url.pathname.endsWith(".css") ||
              url.pathname.endsWith(".js") ||
              url.pathname.endsWith(".html") ||
              url.pathname.endsWith(".woff2") ||
              url.pathname.endsWith("/"))
          ) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
