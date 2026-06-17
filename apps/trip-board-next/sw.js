const CACHE = "trip-board-next-v1";
const SHELL = ["./", "./index.html", "./styles.css", "./app.mjs", "./site.webmanifest"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener("fetch", (event) => { if (event.request.method === "GET") event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request))); });
