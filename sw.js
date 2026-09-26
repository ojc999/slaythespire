/* Service worker: makes the guide work offline.
 * Strategy: network first (so registry updates arrive whenever you are online),
 * falling back to the saved copy when offline or when the network is slow (>3 s).
 * Bump CACHE only if the list of files below changes.
 */
var CACHE = "sts2-guide-v1";
var FILES = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "registry/meta.json",
  "registry/characters.json",
  "registry/maps.json",
  "registry/enemies.json"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function timeout(ms) {
  return new Promise(function (_, reject) { setTimeout(function () { reject(new Error("timeout")); }, ms); });
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // Ignore query strings and cache-busting headers when matching saved copies.
  var key = new Request(req.url.split("?")[0]);
  event.respondWith(
    Promise.race([fetch(req), timeout(3000)]).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(key, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(key).then(function (hit) {
        return hit || caches.match("index.html");
      });
    })
  );
});
