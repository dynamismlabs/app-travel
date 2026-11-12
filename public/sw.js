const CACHE = "app-shell-v1";
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch("/offline.html");
    if (!response.ok) throw new Error("App shell unavailable");
    const html = await response.clone().text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
    await cache.put("/offline.html", response);
    await cache.addAll(assets);
  })());
  self.skipWaiting();
});
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname === "/mcp" || url.pathname.startsWith("/.well-known/")) return;
  if (event.request.mode === "navigate") event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html").then((response) => response || Response.error())));
  else if (url.pathname.startsWith("/assets/")) event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => { if (response.ok) { const copy = response.clone(); void caches.open(CACHE).then((cache) => cache.put(event.request, copy)); } return response; })));
});
