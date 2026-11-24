// الأنوار — إرسال إشعارات Push للموبايل حتى لو البرنامج مقفول
// بيتنادي من قاعدة البيانات (trigger على notifications) بسر الربط، أو من البرنامج علشان ياخد المفتاح العام.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const out = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    let { data: cfg } = await admin.rpc('push_cfg');
    if (!cfg?.pub || !cfg?.priv) {
      const k = webpush.generateVAPIDKeys();
      await admin.rpc('push_cfg_init', { p_pub: k.publicKey, p_priv: k.privateKey });
      cfg = (await admin.rpc('push_cfg')).data;
    }
    const body = await req.json().catch(() => ({}));
    if (body.action === 'key') return out(200, { key: cfg.pub });
    if (!cfg.hook || req.headers.get('x-hook') !== cfg.hook) return out(403, { error: 'forbidden' });
    const { data: n } = await admin.from('notifications').select('id,user_id,title,body,view').eq('id', body.id).single();
    if (!n) return out(404, { error: 'not found' });
    const { data: subs } = await admin.from('push_subs').select('id,endpoint,p256dh,auth').eq('user_id', n.user_id);
    webpush.setVapidDetails('https://alanwartechnology.store', cfg.pub, cfg.priv);
    const { count } = await admin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', n.user_id).is('read_at', null);
    const payload = JSON.stringify({ id: n.id, title: n.title, body: n.body || '', view: n.view || '', unread: count || 0 });
    let sent = 0;
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: 'high' });
        sent++; await admin.from('push_subs').update({ last_ok: new Date().toISOString() }).eq('id', s.id);
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from('push_subs').delete().eq('id', s.id);
      }
    }
    return out(200, { sent });
  } catch (e) { return out(500, { error: String((e as Error).message || e) }); }
});
