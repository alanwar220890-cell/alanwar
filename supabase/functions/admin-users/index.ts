import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const out = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return out(405, { error: 'POST only' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  const { data: who, error: we } = await admin.auth.getUser(jwt);
  if (we || !who?.user) return out(401, { error: 'سجّل دخول الأول' });
  const { data: me } = await admin.from('profiles').select('id,tenant_id,role,active').eq('id', who.user.id).single();
  if (!me || !me.active || me.role !== 'system_admin') return out(403, { error: 'الإجراء ده للمدير العام بس' });
  // لو التحقق بخطوتين إجباري، لازم الجلسة تكون متحققة بيه
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: mok } = await asUser.rpc('mfa_ok');
  if (mok !== true) return out(403, { error: 'ادخل بالتحقق بخطوتين الأول' });
  let b: any;
  try { b = await req.json(); } catch { return out(400, { error: 'طلب غير صحيح' }); }
  const pw = String(b.password || '');
  const pwOk = () => pw.length >= 8;
  const log = (row_id: string, action: string, data: unknown) => admin.from('audit_log').insert({ tenant_id: me.tenant_id, user_id: me.id, table_name: 'auth_users', row_id, action, new_data: data });

  if (b.action === 'reset_mfa') {
    const { data: t } = await admin.from('profiles').select('id,tenant_id,full_name').eq('id', b.user_id).single();
    if (!t || t.tenant_id !== me.tenant_id) return out(404, { error: 'الموظف غير موجود' });
    const { data: f, error: fe } = await admin.auth.admin.mfa.listFactors({ userId: t.id });
    if (fe) return out(400, { error: fe.message });
    let n = 0;
    for (const x of f?.factors || []) { const { error } = await admin.auth.admin.mfa.deleteFactor({ userId: t.id, id: x.id }); if (!error) n++; }
    await log(t.id, 'MFA_RESET', { full_name: t.full_name, removed: n });
    await admin.from('login_events').insert({ tenant_id: me.tenant_id, user_id: t.id, kind: 'mfa_reset', note: 'بواسطة المدير العام', flagged: true });
    return out(200, { ok: true, removed: n });
  }
  if (b.action === 'set_password') {
    if (!pwOk()) return out(400, { error: 'كلمة السر لازم تكون 8 حروف أو أرقام على الأقل' });
    const { data: t } = await admin.from('profiles').select('id,tenant_id,full_name').eq('id', b.user_id).single();
    if (!t || t.tenant_id !== me.tenant_id) return out(404, { error: 'الموظف غير موجود' });
    const { error } = await admin.auth.admin.updateUserById(t.id, { password: pw });
    if (error) return out(400, { error: /weak|short/i.test(error.message) ? 'كلمة السر ضعيفة، خليها أطول وفيها حروف وأرقام' : error.message });
    await log(t.id, 'SET_PASSWORD', { full_name: t.full_name });
    return out(200, { ok: true });
  }
  if (b.action === 'create') {
    if (!pwOk()) return out(400, { error: 'كلمة السر لازم تكون 8 حروف أو أرقام على الأقل' });
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return out(400, { error: 'اكتب إيميل صحيح' });
    const name = String(b.full_name || '').trim();
    if (name.length < 3) return out(400, { error: 'اكتب اسم الموظف' });
    const { data: c, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: name } });
    if (error) return out(400, { error: /already|registered|exists/i.test(error.message) ? 'الإيميل ده عليه حساب قبل كده' : error.message });
    const upd: Record<string, unknown> = { full_name: name, tenant_id: me.tenant_id, active: true };
    if (b.role && b.role !== 'system_admin') upd.role = b.role;
    if (b.branch_id) upd.branch_id = b.branch_id;
    const { error: pe } = await admin.from('profiles').update(upd).eq('id', c.user!.id);
    if (pe) return out(400, { error: 'الحساب اتعمل بس بياناته متسجلتش: ' + pe.message });
    await log(c.user!.id, 'CREATE_USER', { email, full_name: name, role: b.role, branch_id: b.branch_id });
    return out(200, { ok: true, id: c.user!.id });
  }
  if (b.action === 'delete') {
    // حذف حساب موظف: لازم كلمة سر المدير العام
    if (!b.admin_password) return out(400, { error: 'اكتب كلمة السر بتاعتك' });
    const chk = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: si, error: se } = await chk.auth.signInWithPassword({ email: who.user.email!, password: String(b.admin_password) });
    if (se || si?.user?.id !== me.id) return out(403, { error: 'كلمة السر غلط' });
    try { await chk.auth.signOut({ scope: 'local' }); } catch (_) { /**/ }
    const { data: r, error } = await admin.rpc('user_delete', { p_tenant: me.tenant_id, p_actor: me.id, p_user: String(b.user_id || ''), p_to: b.transfer_to || null, p_reason: b.reason ? String(b.reason).slice(0, 300) : null });
    if (error) return out(400, { error: error.message });
    const id = String(b.user_id);
    if (r?.hard) {
      // مالوش أي شغل مسجل: يتمسح نهائي
      const { error: de } = await admin.auth.admin.deleteUser(id);
      if (de) await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
    } else {
      // ليه شغل مسجل: الحساب يتقفل ويفضل اسمه في السجلات، والإيميل يتحرر علشان ينفع يتستخدم تاني
      await admin.auth.admin.updateUserById(id, { ban_duration: '876000h', email: `deleted-${id.slice(0, 8)}-${Date.now()}@deleted.invalid`, email_confirm: true });
    }
    try { await admin.rpc('sec_notify_admins', { t: me.tenant_id, ttl: 'تم حذف حساب موظف', body: `اتحذف حساب «${r?.name || ''}» بواسطة المدير العام${b.reason ? ' — السبب: ' + String(b.reason).slice(0, 200) : ''}` }); } catch (_) { /**/ }
    return out(200, { ok: true, ...r });
  }
  return out(400, { error: 'إجراء غير معروف' });
});
