// الأنوار — حذف بيانات العملاء (لمدير النظام فقط وبعد إدخال كلمة السر)
import { createClient } from 'npm:@supabase/supabase-js@2';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const out = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const KINDS = ['customer', 'contract', 'investigation', 'lead', 'legal_only', 'renew'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, auth = req.headers.get('Authorization') || '';
    const db = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: u } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    if (!u?.user?.email) return out(401, { error: 'سجّل دخول الأول' });
    const { data: me } = await admin.from('profiles').select('id,tenant_id,role,active').eq('id', u.user.id).single();
    if (!me || !me.active || me.role !== 'system_admin') return out(403, { error: 'الحذف متاح لمدير النظام بس' });
    const { data: mok } = await db.rpc('mfa_ok');
    if (mok !== true) return out(403, { error: 'ادخل بالتحقق بخطوتين الأول' });
    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind || ''), ids = Array.isArray(body.ids) ? body.ids.filter((x: any) => UUID.test(String(x))) : [];
    if (!KINDS.includes(kind)) return out(400, { error: 'نوع الحذف غير معروف' });
    if (!ids.length) return out(400, { error: 'مفيش حاجة متحددة للحذف' });
    if (!body.password) return out(400, { error: 'اكتب كلمة السر' });
    // التأكد من كلمة السر بتسجيل دخول منفصل
    const chk = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: si, error: se } = await chk.auth.signInWithPassword({ email: u.user.email, password: String(body.password) });
    if (se || si?.user?.id !== u.user.id) return out(403, { error: 'كلمة السر غلط' });
    try { await chk.auth.signOut({ scope: 'local' }); } catch (_) { /**/ }
    const { data, error } = await admin.rpc('purge_records', { p_tenant: me.tenant_id, p_actor: me.id, p_kind: kind, p_ids: ids, p_reason: body.reason || null });
    if (error) return out(400, { error: error.message });
    const files: string[] = (data?.files || []).filter(Boolean);
    for (let i = 0; i < files.length; i += 100) { try { await admin.storage.from('inv-docs').remove(files.slice(i, i + 100)); } catch (_) { /**/ } }
    const nd = data?.deleted || 0;
    if (nd >= 20 || kind === 'customer') { try { await admin.rpc('sec_notify_admins', { t: me.tenant_id, ttl: 'تنبيه حذف بيانات', body: `اتحذف ${nd} (${kind}) بواسطة المدير العام${body.reason ? ' — السبب: ' + String(body.reason).slice(0, 200) : ''}` }); } catch (_) { /**/ } }
    return out(200, { deleted: data?.deleted || 0, files: files.length });
  } catch (e) { return out(500, { error: String((e as Error).message || e) }); }
});
