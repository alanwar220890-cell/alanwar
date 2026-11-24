// الأنوار — نسخة احتياطية مشفّرة (RSA-OAEP-4096 + AES-256-GCM)
// المفتاح العام بس على السيرفر؛ المفتاح الخاص مع المدير العام في ملف محمي بكلمة سر. يعني محدش يقدر يفتح النسخة من الدرايف أو الإيميل.
import { createClient } from 'npm:@supabase/supabase-js@2';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const out = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function gzip(text: string) {
  const cs = new CompressionStream('gzip'); const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(text)); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || '');
    if (token.length < 20) return out(400, { error: 'invalid token' });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: t } = await admin.rpc('_worker_tenant', { p_token: token, p_purpose: 'backup' });
    if (!t) return out(403, { error: 'invalid token' });
    const { data: k } = await admin.from('app_settings').select('value').eq('tenant_id', t).eq('key', 'backup_pubkey').maybeSingle();
    if (!k?.value?.spki) return out(400, { error: 'لسه مفيش مفتاح تشفير — اعمله من البرنامج: الإدارة ← تشفير النسخ الاحتياطية' });
    const { data: dump, error } = await admin.rpc('backup_fetch', { p_token: token });
    if (error || !dump?.tables) return out(500, { error: 'فشل تجهيز النسخة: ' + (error?.message || 'empty') });
    const counts: Record<string, number> = {};
    for (const [n, rows] of Object.entries(dump.tables as Record<string, unknown[]>)) counts[n] = Array.isArray(rows) ? rows.length : 0;
    const plain = await gzip(JSON.stringify(dump));
    const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, plain));
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', aes));
    const pub = await crypto.subtle.importKey('spki', unb64(k.value.spki), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const wk = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, raw));
    return out(200, { app: 'ALANWAR AI', v: 1, alg: 'RSA-OAEP-256+AES-256-GCM+gzip', fp: k.value.fp, at: new Date().toISOString(), counts, key: b64(wk), iv: b64(iv), data: b64(ct) });
  } catch (e) { return out(500, { error: String((e as Error).message || e) }); }
});
