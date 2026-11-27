// Big Two offline helper (service worker).
// The first visit with internet saves the whole app on the device. After that the app opens
// from this saved copy straight away, with or without signal. When there is signal, it quietly
// fetches the newest version in the background, which is used the next time the app is opened.

var CACHE = "bigtwo-v2";
var APP_FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "fonts/roboto-slab.woff2",
  "fonts/roboto.woff2",
  "img/logo.svg",
  "img/icon2.ico",
  "img/apple-touch-icon.png",
  "img/icon-192.png",
  "img/icon-512.png",
  "coach/",
  "coach/index.html",
  "coach/engine.js",
  "coach/app.js",
  "coach/sim-worker.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(APP_FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // e.g. outside links: leave alone

  // A page (the calculator, or the coach) is looked up by its address without the ?… part,
  // so ?num=4&player1=… still opens the saved page.
  var isPage = req.mode === "navigate";
  var key = isPage ? new Request(url.origin + url.pathname) : req;

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(key, { ignoreSearch: isPage }).then(function (saved) {
        // Refresh the saved copy in the background whenever there is signal.
        // (a page request can't be re-sent with options, so the page is fetched by its plain address)
        var fresh = fetch(isPage ? key.url : req.url, { cache: "no-cache" })
          .then(function (res) {
            if (res && res.ok) cache.put(key, res.clone());
            return res;
          })
          .catch(function () { return null; });
        if (saved) {
          event.waitUntil(fresh);
          return saved;
        }
        return fresh.then(function (res) {
          if (res) return res;
          if (!isPage) return Response.error();
          var inCoach = url.pathname.indexOf("/coach/") >= 0;
          return cache.match(new URL(inCoach ? "coach/index.html" : "index.html", self.location).href);
        });
      });
    })
  );
});
