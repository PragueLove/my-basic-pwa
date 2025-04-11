// Service Worker 文件: 控制缓存和离线行为

const CACHE_NAME = 'my-basic-pwa-cache-v1';
// 需要缓存的核心文件列表 (应用外壳 App Shell)
const urlsToCache = [
  '/',                  // 通常网站根目录会映射到 index.html
  '/index.html',
  '/style.css',
  '/script.js',
  '/images/icons/icon-192x192.png', // 确保缓存图标
  '/images/icons/icon-512x512.png'
  // 注意：如果你的 HTML/CSS/JS 引用了其他静态资源 (如字体、其他图片)，
  // 并且你希望它们离线可用，也需要将它们添加到这里。
];

// --- 生命周期事件 ---

// 1. 安装 (Install) 事件：在 Service Worker 首次注册时触发
self.addEventListener('install', event => {
  console.log('Service Worker: Installing...');
  // waitUntil 确保在所有核心文件缓存完成之前，安装阶段不会结束
  event.waitUntil(
    caches.open(CACHE_NAME) // 打开指定名称的缓存
      .then(cache => {
        console.log('Service Worker: Caching app shell');
        return cache.addAll(urlsToCache); // 将列表中的所有文件添加到缓存
      })
      .then(() => {
        console.log('Service Worker: App shell cached successfully');
        // self.skipWaiting() // 可选: 强制新的 Service Worker 立即激活 (替换旧的)
                             // 通常在需要立即应用更新时使用，但初学可以先不用
      })
      .catch(error => {
        console.error('Service Worker: Failed to cache app shell:', error);
      })
  );
});

// 2. 激活 (Activate) 事件：在 Service Worker 安装成功并准备好控制页面时触发
// 主要用于清理旧版本的缓存
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating...');
  const cacheWhitelist = [CACHE_NAME]; // 定义当前版本的缓存白名单

  event.waitUntil(
    caches.keys().then(cacheNames => { // 获取所有缓存的名称
      return Promise.all(
        cacheNames.map(cacheName => {
          // 如果缓存名称不在白名单中，则删除它 (清理旧缓存)
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
        console.log('Service Worker: Activated successfully');
        // return self.clients.claim(); // 可选: 让新的 Service Worker 立即控制当前打开的页面
                                    // 通常与 skipWaiting 配合使用
    })
  );
});

// 3. 抓取 (Fetch) 事件：拦截页面发出的所有网络请求 (如加载 CSS, JS, 图片, API 请求等)
self.addEventListener('fetch', event => {
  // console.log('Service Worker: Fetching ', event.request.url);

  // 缓存优先策略 (Cache First) - 适用于静态资源
  event.respondWith( // 劫持响应
    caches.match(event.request) // 尝试在缓存中查找匹配的请求
      .then(response => {
        // 如果在缓存中找到匹配的响应，则直接返回缓存的响应
        if (response) {
          // console.log('Service Worker: Returning response from cache:', event.request.url);
          return response;
        }
        // 如果缓存中没有找到，则通过网络去获取
        // console.log('Service Worker: Fetching from network:', event.request.url);
        return fetch(event.request);
        // 你还可以将网络获取的响应添加到缓存中，以便下次使用 (可选的进阶操作)
        /*
        return fetch(event.request).then(networkResponse => {
            // 检查响应是否有效
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            // 克隆响应，因为响应体只能被读取一次
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseToCache);
            });
            return networkResponse;
        });
        */
      })
      .catch(error => {
          console.error('Service Worker: Error fetching data:', error);
          // 可选: 提供一个通用的离线页面或资源作为后备
          // return caches.match('/offline.html');
      })
  );
});

// --- 其他事件 (可选) ---
// self.addEventListener('push', event => { ... });      // 处理推送通知
// self.addEventListener('sync', event => { ... });      // 处理后台同步