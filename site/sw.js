/* Offline support. Bump VERSION when site files change. */
var VERSION = "rpm-v1";
var SHELL = [
  "./", "index.html", "checkin.html", "privacy.html",
  "styles.css", "app.js", "config.js", "manifest.json",
  "icons/icon-192.png", "icons/icon-512.png", "icons/logo-black.png", "icons/logo-white.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return; // API, YouTube: always live

  // Pages and code: try the network first so updates show, fall back to the saved copy offline
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match("index.html"); });
    })
  );
});
