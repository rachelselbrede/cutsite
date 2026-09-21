/* ============================================================
   CutSite  -  service worker
   ------------------------------------------------------------
   The game is four small files and no dependencies, so it can be
   cached whole. That is what makes it installable: a manifest
   alone is not enough for a browser to offer "Install", and a
   game about a daily puzzle wants to survive a lab basement with
   no signal.

   Two rules, and the reason for each:

   - The page itself is fetched from the network first, and only
     falls back to the cache offline. A game served cache-first
     would keep showing yesterday's build after a deploy, and
     this is a live site with no other way to tell a player that
     a new version exists.

   - Everything else - CSS, JS, icons, the manifest - is served
     from the cache first, because every one of those URLs
     carries its version in the query string or its name. A
     cached style.css?v=34 is never the wrong style.css?v=34, so
     there is nothing to go stale. The freshly fetched page asks
     for the new URLs and they miss the cache exactly once.

   VERSION has to match the ?v= on the tags in index.html.
   tests/check_pwa.py fails the build if it ever drifts.
   ============================================================ */
const VERSION = "35";
const CACHE = "cutsite-v" + VERSION;

const PRECACHE = [
  "./",
  "./index.html",
  "./style.css?v=" + VERSION,
  "./script.js?v=" + VERSION,
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  // Self-hosted now, so they belong in the cache like anything else. An
  // installed copy opening in system fonts was the old offline story.
  "./fonts/ibm-plex-sans-var.woff2",
  "./fonts/ibm-plex-mono-500.woff2",
  "./fonts/ibm-plex-mono-700.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // One bad URL would reject addAll and leave the worker uninstalled,
      // taking the whole offline story with it, so each is cached alone.
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only plain GETs of our own files. Nothing the page needs is served
  // from another origin any more, so anything cross-origin is somebody
  // else's problem and caching an opaque response would only hide it.
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((hit) => hit || caches.match("./")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // Errors and redirects are not worth keeping; a 200 is.
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
