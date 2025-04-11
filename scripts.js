// 基本功能：显示当前时间
function updateTime() {
    const timeElement = document.getElementById('time');
    if (timeElement) {
        timeElement.textContent = new Date().toLocaleTimeString();
    }
}

// 页面加载时和之后每秒更新时间
window.addEventListener('load', () => {
    updateTime();
    setInterval(updateTime, 1000);
});

// --- PWA Service Worker 注册逻辑 ---
// 检查浏览器是否支持 Service Worker
if ('serviceWorker' in navigator) {
  // 在页面加载完成后注册 Service Worker
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js') // 注意路径是相对于域名的根目录
      .then(registration => {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);
      })
      .catch(error => {
        console.log('ServiceWorker registration failed: ', error);
      });
  });
} else {
  console.log('Service Worker not supported by this browser.');
}


//我的文件是好的
