// الأنوار — Service Worker: بيخلي البرنامج يتثبت كتطبيق ويفتح أسرع.
// البيانات نفسها (Supabase) مش بتتخزن، بتيجي دايمًا من السيرفر.
const C = 'alanwar-v7';
const CORE = ['./', 'index.html', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'logo.png', 'mark.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(CORE)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  // ملفات ثابتة متغيرش (app.js?v=… ومكتبة Supabase والخطوط والصور): من الجهاز على طول من غير ما نستنى النت
  const fixed = (u.origin === location.origin && (/[?&]v=\d+/.test(u.search) || /\.(png|jpg|svg|webp|woff2?)$/.test(u.pathname))) || /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[\d.]+\//.test(r.url) || /fonts\.(gstatic|googleapis)\.com/.test(u.host);
  if (fixed) { e.respondWith(caches.open(C).then(c => c.match(r).then(m => m || fetch(r).then(res => { if (res.ok || res.type === 'opaque') { c.put(r, res.clone()); if (/app\.js$/.test(u.pathname)) c.keys().then(ks => ks.forEach(k => { const ku = new URL(k.url); if (/app\.js$/.test(ku.pathname) && ku.search !== u.search) c.delete(k); })); } return res; })))); return; }
  if (u.origin !== location.origin) return;
  // الشبكة الأول علشان أي تحديث يوصل على طول، والنسخة المحفوظة لو النت قاطع
  e.respondWith(fetch(r, { cache: 'no-cache' }).then(res => { if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); } return res; })
    .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html'))));
});
// لما الموظف يدوس على إشعار الجهاز: يفتح البرنامج على القسم بتاعه
self.addEventListener('notificationclick', e => {
  e.notification.close(); const v = (e.notification.data && e.notification.data.view) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(L => {
    for (const c of L) { if ('focus' in c) { c.postMessage({ ntGo: v }); return c.focus(); } }
    return self.clients.openWindow('./' + (v ? '#' + v : ''));
  }));
});
// إشعار Push من السيرفر: بيظهر حتى لو البرنامج مقفول
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: e.data ? e.data.text() : 'الأنوار' }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(L => {
    const vis = L.some(c => c.visibilityState === 'visible');
    // لو البرنامج مفتوح قدام الموظف، البرنامج نفسه بيعرض الإشعار بالصوت
    if (vis) return;
    if (navigator.setAppBadge && d.unread) navigator.setAppBadge(d.unread).catch(() => {});
    return self.registration.showNotification(d.title || 'الأنوار', { body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'n' + (d.id || Date.now()), data: { view: d.view || '' }, vibrate: [200, 100, 200], renotify: true, requireInteraction: false, dir: 'rtl', lang: 'ar' });
  }));
});
