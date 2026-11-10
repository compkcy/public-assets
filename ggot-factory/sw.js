// 오프라인 실행용 서비스워커. HTTPS(또는 localhost)에서 첫 방문 때 앱 파일을 모두 내려받아 둔다.
// 이후에는 서버/인터넷 연결 없이 캐시에서 앱을 연다(cache-first). 기록 데이터는 캐시가 아니라 IndexedDB에 있다.
// 배포할 때마다 VERSION이 바뀌어야 새 버전이 설치된다(GitHub Actions 배포는 커밋 해시를 자동으로 붙인다).
const VERSION = 'ggot-0.4.0';
const ASSETS = [
  './', './index.html', './style.css', './manifest.webmanifest',
  './src/app.js', './src/model.js', './src/questions.js', './src/i18n.js', './src/store.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  // cache: 'reload' → HTTP 캐시를 거치지 않고 서버의 최신 파일을 받는다. 하나라도 실패하면 설치 실패(반쪽 캐시 방지).
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('ggot-') && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

// 새 버전은 사용자가 [지금 적용]을 눌렀을 때만 활성화 → 입력 도중 화면이 바뀌지 않는다.
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (req.mode === 'navigate') return (await cache.match('./index.html')) || fetch(req);
    // 중국 현장처럼 서버가 막히거나 느려도 기다리지 않도록 캐시를 먼저 쓴다.
    return (await cache.match(req, { ignoreSearch: true })) || fetch(req);
  })());
});
