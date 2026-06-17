const CACHE_NAME = "tripboard-shell-v18";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=18",
  "./app.mjs?v=18",
  "./ai-core.mjs?v=18",
  "./gemini-client.mjs?v=18",
  "./local-store.mjs?v=17",
  "./core.mjs?v=14",
  "./site.webmanifest?v=18",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", response.clone()));
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
