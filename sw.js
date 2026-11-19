// 오프라인 캐시: 네트워크 우선, 실패하면 저장된 사본으로 실행 (게임을 고치면 다음 실행 때 자동 갱신)
const C = 'ironsky-v4';
const FILES = ['./index.html', './game.js', './story.js', './story-data.js', './assets/story/manifest.js',
  ...['stage1', 'stage2', 'stage3', 'stage4', 'stage5'].map(s => `./assets/story/backgrounds/${s}/main.jpg`),
  './assets/story/endings/destruction.jpg', './assets/story/endings/sunrise.jpg',
  ...['commander', 'falcon1', 'wingman', 'intel', 'enemy'].map(c => `./assets/story/characters/${c}/portrait.jpg`), './manifest.webmanifest', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok || r.type === 'opaque') { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
