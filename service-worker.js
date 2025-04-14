// Service Worker for Sports Tracker PWA

// 缓存名称 - 更改版本号会使旧缓存失效
const CACHE_NAME = 'sports-tracker-v3';

// 需要缓存的资源列表
const CACHE_URLS = [
    './',
    './index.html',
    './main.html',
    './style.css',
    './app.js',
    './auth.js',
    './manifest.json',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png'
    // Note: We are NOT caching Leaflet's CDN files here.
    // Caching external resources can be complex (CORS, versioning).
    // The app will require internet for map tiles and the Leaflet library itself.
    // For full offline map capability, you'd need to cache tiles, which is advanced.
];

// 安装事件 - 预缓存资源
self.addEventListener('install', event => {
    console.log('Service Worker: Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker: Caching app shell');
                return cache.addAll(CACHE_URLS);
            })
            .then(() => {
                console.log('Service Worker: App shell cached successfully');
                return self.skipWaiting();
            })
    );
});

// 激活事件 - 清理旧缓存
self.addEventListener('activate', event => {
    console.log('Service Worker: Activating...');
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('Service Worker: Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('Service Worker: Activated successfully');
                return self.clients.claim();
            })
    );
});

// 请求拦截
self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);
    
    // 只处理同源的 GET 请求
    if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) {
        return;
    }

    // 对于 main.html，始终从网络获取最新版本
    if (requestUrl.pathname.endsWith('main.html')) {
        event.respondWith(
            fetch(event.request)
                .catch(() => caches.match(event.request))
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
