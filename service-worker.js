// Service Worker for Sports Tracker PWA

// Increment version number when you update the app shell files
const CACHE_NAME = 'sports-tracker-v2';
// Core files to cache (App Shell)
const CACHE_URLS = [
  '/',
  '/index.html',
  '/main.html',
  '/style.css',
  '/app.js',
  '/auth.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
  // Note: We are NOT caching Leaflet's CDN files here.
  // Caching external resources can be complex (CORS, versioning).
  // The app will require internet for map tiles and the Leaflet library itself.
  // For full offline map capability, you'd need to cache tiles, which is advanced.
];

// --- Install Event ---
self.addEventListener('install', event => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching app shell');
        // Use addAll for atomic caching
        return cache.addAll(CACHE_URLS);
      })
      .then(() => {
        console.log('Service Worker: App shell cached successfully');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('Service Worker: Failed to cache app shell:', error);
      })
  );
});

// --- Activate Event ---
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating...');
  const cacheWhitelist = [CACHE_NAME]; // Keep only the current cache

  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
        console.log('Service Worker: Activated successfully');
        return self.clients.claim();
    })
  );
});

// --- Fetch Event (Cache First for App Shell) ---
self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);

    // Only handle GET requests and local assets (same origin)
    if (event.request.method === 'GET' && requestUrl.origin === self.location.origin) {
        // Respond from cache first for app shell resources
        event.respondWith(
            caches.match(event.request)
            .then(response => {
                // If found in cache, return it
                if (response) {
                    // console.log('Service Worker: Returning response from cache:', event.request.url);
                    return response;
                }
                // If not in cache, fetch from network
                // console.log('Service Worker: Fetching from network:', event.request.url);
                return fetch(event.request);
                // Optional: Cache fetched resource? Be careful not to cache everything.
            })
            .catch(error => {
                console.error('Service Worker: Error fetching data:', error);
                // Optional: Fallback for offline page?
                // if (event.request.mode === 'navigate') { // Only for page navigation
                //   return caches.match('/offline.html');
                // }
            })
        );
    }
    // Let the browser handle other requests (like CDN or API calls) normally

    // 对于主页面，始终从网络获取最新版本
    if (event.request.url.includes('main.html')) {
        event.respondWith(
            fetch(event.request)
                .catch(error => {
                    return caches.match(event.request);
                })
        );
        return;
    }

    // 对其他资源使用 Cache First 策略
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request)
                    .then(response => {
                        // 只缓存成功的响应
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            });
                        return response;
                    });
            })
    );
});
