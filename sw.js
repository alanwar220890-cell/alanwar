// الأنوار — Service Worker: بيخلي البرنامج يتثبت كتطبيق ويفتح أسرع.
// البيانات نفسها (Supabase) مش بتتخزن، بتيجي دايمًا من السيرفر.
const C = 'alanwar-v1';
const CORE = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(CORE)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  // الشبكة الأول علشان أي تحديث يوصل على طول، والنسخة المحفوظة لو النت قاطع
  e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); } return res; })
    .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html'))));
});
