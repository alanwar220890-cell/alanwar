// الأنوار — مراجعة الاستعلامات: فحص البيانات بقواعد ثابتة + رأي الذكاء الاصطناعي + نموذج قرار (Operations Research)
// المرحلة credit: بعد بيانات الاستعلام الائتماني. المرحلة visit: بعد الزيارة الميدانية.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { robustDecide, CLAIMS } from './robust.ts';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const out = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const GOV: Record<string, string> = { '01': 'القاهرة', '02': 'الإسكندرية', '03': 'بورسعيد', '04': 'السويس', '11': 'دمياط', '12': 'الدقهلية', '13': 'الشرقية', '14': 'القليوبية', '15': 'كفر الشيخ', '16': 'الغربية', '17': 'المنوفية', '18': 'البحيرة', '19': 'الإسماعيلية', '21': 'الجيزة', '22': 'بني سويف', '23': 'الفيوم', '24': 'المنيا', '25': 'أسيوط', '26': 'سوهاج', '27': 'قنا', '28': 'أسوان', '29': 'الأقصر', '31': 'البحر الأحمر', '32': 'الوادي الجديد', '33': 'مطروح', '34': 'شمال سيناء', '35': 'جنوب سيناء', '88': 'خارج الجمهورية' };
const num = (v: any) => (v == null || v === '' || isNaN(+v) ? null : +v);

function nid(n?: string, birth?: string) {
  const r: any = { ok: false };
  if (!/^\d{14}$/.test(n || '')) { r.err = 'الرقم القومي مش 14 رقم'; return r; }
  const c = n![0] === '2' ? 1900 : n![0] === '3' ? 2000 : 0;
  const y = c + +n!.slice(1, 3), m = +n!.slice(3, 5), d = +n!.slice(5, 7);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (!c || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) { r.err = 'تاريخ الميلاد في الرقم القومي غير صحيح'; return r; }
  r.birth = dt.toISOString().slice(0, 10); r.age = Math.floor((Date.now() - dt.getTime()) / 31557600000);
  r.gov = GOV[n!.slice(7, 9)] || null; if (!r.gov) { r.err = 'كود المحافظة في الرقم القومي غير معروف'; return r; }
  r.gender = +n![12] % 2 ? 'ذكر' : 'أنثى'; r.ok = true;
  if (birth && birth.slice(0, 10) !== r.birth) { r.warn = 'تاريخ الميلاد المكتوب (' + birth.slice(0, 10) + ') مش مطابق للرقم القومي (' + r.birth + ')'; }
  return r;
}
const phoneOk = (p?: string) => /^01[0125]\d{8}$/.test(String(p || '').replace(/\D/g, '').replace(/^20/, '0').replace(/^2(?=01)/, ''));

// ===== الفحوص الثابتة
function checks(i: any, stage: string) {
  const C: any[] = []; const add = (ok: boolean | null, t: string, pts = 0, sev = 'mid') => C.push({ ok, t, pts: ok === false ? pts : 0, sev });
  const N = nid(i.national_id, i.birth_date);
  add(N.ok, N.ok ? `الرقم القومي سليم — ${N.gender}، ${N.age} سنة، مواليد ${N.gov}` : N.err, 30, 'high');
  if (N.warn) add(false, N.warn, 8);
  if (N.ok) add(N.age >= 21 && N.age <= 65, N.age < 21 ? 'السن أقل من 21' : N.age > 65 ? 'السن أكبر من 65' : 'السن مناسب للتقسيط', 10);
  add(phoneOk(i.customer_phone), phoneOk(i.customer_phone) ? 'رقم الموبايل بصيغة مصرية صحيحة' : 'رقم الموبايل ناقص أو بصيغة غلط', 6);
  const inc = num(i.monthly_income) ?? num(i.net_income), inst = num(i.new_installment), obl = num(i.obligations_monthly) ?? 0;
  add(inc != null && inc > 0, inc ? 'الدخل الشهري مسجل' : 'الدخل الشهري مش مسجل', 12, 'high');
  add(inst != null && inst > 0, inst ? 'القسط المطلوب مسجل' : 'القسط الجديد مش مسجل', 6);
  const dti = inc ? (obl + (inst || 0)) / inc : null;
  if (dti != null) add(dti <= 0.4, `نسبة الالتزام من الدخل ${Math.round(dti * 100)}%` + (dti > 0.4 ? ' — أعلى من 40%' : ''), dti > 0.5 ? 30 : dti > 0.4 ? 18 : 0, dti > 0.5 ? 'high' : 'mid');
  add(!!(i.job_title || i.employer_name), i.job_title || i.employer_name ? 'الوظيفة/جهة العمل مسجلة' : 'مفيش وظيفة أو جهة عمل', 8);
  add(!!i.housing, i.housing ? 'نوع السكن مسجل' : 'نوع السكن مش مسجل', 3, 'low');
  if (i.housing === 'new_rent') add(false, 'السكن إيجار جديد (استقرار أقل)', 5, 'low');
  if (i.residence_years != null) add(+i.residence_years >= 2, `مدة الإقامة ${i.residence_years} سنة`, 4, 'low');
  // بيانات البطاقات المقروءة آليًا
  const ID = i.id_data || {}, td = new Date().toISOString().slice(0, 10), nrm = (x: any) => String(x || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
  for (const [w, lb, cur] of [['buyer', 'المشتري', { name: i.customer_name, national_id: i.national_id }], ['g1', 'الضامن الأول', i.guarantor1 || {}], ['g2', 'الضامن الثاني', i.guarantor2 || {}]] as any[]) {
    const x = ID[w]; if (!x) continue;
    if (x.expiry_date) add(x.expiry_date >= td, x.expiry_date >= td ? `بطاقة ${lb} سارية حتى ${x.expiry_date}` : `بطاقة ${lb} منتهية (${x.expiry_date})`, w === 'buyer' ? 10 : 6);
    if (x.national_id && cur.national_id && x.national_id !== cur.national_id) add(false, `الرقم القومي لـ${lb} مختلف عن البطاقة`, 15, 'high');
    if (x.name && cur.name && nrm(x.name) !== nrm(cur.name) && !nrm(x.name).startsWith(nrm(cur.name).split(' ').slice(0, 2).join(' '))) add(false, `اسم ${lb} المسجل مش مطابق للبطاقة`, 6);
  }
  const g1 = i.guarantor1 || {}, g2 = i.guarantor2 || {};
  add(!!g1.name, g1.name ? 'فيه ضامن أول' : 'مفيش ضامن', 12, 'high');
  if (g1.national_id) { const G = nid(g1.national_id); add(G.ok && g1.national_id !== i.national_id, G.ok ? (g1.national_id === i.national_id ? 'رقم قومي الضامن هو نفس رقم المشتري' : `رقم قومي الضامن الأول سليم (${G.age} سنة)`) : 'رقم قومي الضامن الأول: ' + G.err, 15, 'high'); }
  if (g2.national_id) { const G = nid(g2.national_id); add(G.ok, G.ok ? `رقم قومي الضامن الثاني سليم (${G.age} سنة)` : 'رقم قومي الضامن الثاني: ' + G.err, 8); }
  if (stage === 'visit') {
    const f = i.visit_form || {}, b = f.b || {};
    add(i.visit_verified !== false, i.visit_verified === false ? 'السكن غير مطابق في الزيارة' : i.visit_verified ? 'السكن مطابق في الزيارة' : 'مطابقة السكن مش متسجلة', i.visit_verified === false ? 25 : 0, 'high');
    if (i.visit_job_verified != null) add(i.visit_job_verified, i.visit_job_verified ? 'جهة العمل مطابقة' : 'جهة العمل غير مطابقة', 20, 'high');
    add(!!i.visit_lat, i.visit_lat ? 'موقع الزيارة متسجل بالـ GPS' : 'موقع الزيارة مش متسجل', 5, 'low');
    if (b.income != null && inc) { const r = +b.income / inc; add(r >= 0.75 && r <= 1.33, `الدخل في الزيارة ${b.income} مقابل ${inc} في الاستعلام`, 15, 'high'); }
    for (const [k, lb] of [['b', 'المشتري'], ['g1', 'الضامن الأول'], ['g2', 'الضامن الثاني']]) {
      const p = f[k] || {};
      if (p.reputation) add(p.reputation !== 'سيئ', `سمعة ${lb} بالمنطقة: ${p.reputation}`, p.reputation === 'سيئ' ? (k === 'b' ? 20 : 10) : 0, 'high');
      if (p.rating) add(p.rating !== 'سيئ', `تقييم المستعلم لـ${lb}: ${p.rating}`, p.rating === 'سيئ' ? (k === 'b' ? 20 : 8) : 0, 'high');
      if (p.outside) add(p.outside !== 'نعم', `${lb}: تقسيط من الخارج / ديون في المنطقة = ${p.outside}${p.outside_details ? ' (' + p.outside_details + ')' : ''}`, k === 'b' ? 10 : 5);
    }
    const rel = (f.rel || []).filter((r: any) => r && r.name && r.phone).length;
    add(rel >= 2, `أقارب للتواصل: ${rel}`, rel === 0 ? 8 : 3, 'low');
    add(!!f.notice, f.notice ? 'العميل اتبلغ بتنبيه الـ 21 يوم' : 'التنبيه متسجلش إنه اتبلغ', 2, 'low');
  }
  return { C, N, inc, inst, obl, dti };
}

// ===== نموذج القرار (OR): نقط الخطر + أقصى قسط آمن بتعظيم القسط تحت قيود الخطر ونسبة الالتزام
function decide(pts: number, inc: number | null, obl: number, inst: number | null) {
  const cap = Math.max(0.2, Math.min(0.4, 0.42 - pts / 500)); // كل ما الخطر يزيد، الحد الآمن لنسبة الالتزام يقل
  const maxInst = inc ? Math.max(0, Math.floor((inc * cap - obl) / 50) * 50) : null;
  let decision = pts >= 60 ? 'reject' : pts >= 30 ? 'conditional' : 'approve';
  const cond: string[] = [];
  if (inst && maxInst != null) {
    if (inst > maxInst * 1.3) decision = 'reject';
    else if (inst > maxInst) { if (decision === 'approve') decision = 'conditional'; cond.push(`تقليل القسط لـ ${maxInst} ج أو أقل (بمقدم أكبر أو مدة أطول)`); }
  }
  if (decision === 'conditional' && pts >= 30) cond.push('ضامن إضافي موظف بدخل ثابت');
  if (decision === 'conditional' && pts >= 45) cond.push('مقدم لا يقل عن 20%');
  const pd = Math.min(0.95, 0.03 + Math.pow(pts / 100, 1.6) * 0.8);
  return { decision, cap: Math.round(cap * 100), maxInst, pd: Math.round(pd * 100), cond };
}

async function llm(prompt: string, admin: any, tenant: string) {
  const okey = Deno.env.get('OPENAI_API_KEY'), gkey = Deno.env.get('GEMINI_API_KEY');
  if (!okey && !gkey) return { skipped: 'لسه مفيش مفتاح ذكاء اصطناعي' };
  const { data: row } = await admin.from('app_settings').select('value').eq('tenant_id', tenant).eq('key', 'ai_config').maybeSingle();
  const c = row?.value || {};
  const prov = c.provider === 'openai' && okey ? 'openai' : c.provider === 'gemini' && gkey ? 'gemini' : (okey ? 'openai' : 'gemini');
  const key = prov === 'openai' ? okey! : gkey!;
  const url = prov === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  let models = [(prov === 'openai' ? c.model : c.gemini_model) || (prov === 'openai' ? 'gpt-5.4-mini' : 'gemini-3.8-flash')];
  if (prov === 'gemini') { try { const l = await (await fetch('https://generativelanguage.googleapis.com/v1beta/openai/models', { headers: { Authorization: `Bearer ${key}` } })).json(); const ids = (l?.data || []).map((x: any) => String(x.id).replace(/^models\//, '')).filter((x: string) => /flash/.test(x) && !/image|tts|audio|live|embed|preview|exp/.test(x)); const v = (x: string) => parseFloat((x.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0'); ids.sort((a: string, b: string) => v(b) - v(a)); models = [...new Set([...models, ...ids.slice(0, 5)])]; } catch (_) { /**/ } }
  let last = '';
  for (const m of models) {
    for (let t = 0; t < 2; t++) {
      const body: any = { model: m, messages: [{ role: 'system', content: 'انت محلل ائتمان خبير في شركات البيع بالتقسيط في مصر. رد بـ JSON بس من غير أي كلام قبله أو بعده.' }, { role: 'user', content: prompt }], response_format: { type: 'json_object' } };
      if (prov === 'openai') body.max_completion_tokens = 2500; else { body.max_tokens = 2500; body.reasoning_effort = 'low'; }
      const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j0 = await r.json().catch(() => ({})); const j = Array.isArray(j0) ? j0[0] : j0;
      if (r.ok) {
        const txt = j.choices?.[0]?.message?.content || '';
        await admin.from('ai_usage').insert({ tenant_id: tenant, user_id: null, model: prov + ':' + m + ':inv', prompt_tokens: j.usage?.prompt_tokens || 0, completion_tokens: j.usage?.completion_tokens || 0 });
        try { return { model: m, ...JSON.parse(txt.replace(/^```(json)?/i, '').replace(/```$/, '').trim()) }; } catch (_) { const mm = txt.match(/\{[\s\S]*\}/); if (mm) try { return { model: m, ...JSON.parse(mm[0]) }; } catch (_) { /**/ } return { model: m, summary: txt.slice(0, 1500) }; }
      }
      last = String(j?.error?.message || r.status);
      if (prov === 'openai' || !/demand|overload|unavailable|503|429|not found|no longer|quota|exhausted/i.test(last + r.status)) return { error: last };
      if (t === 0) await new Promise((z) => setTimeout(z, 1200));
    }
  }
  return { error: last };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, auth = req.headers.get('Authorization') || '';
    const db = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: u } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    if (!u?.user) return out(401, { error: 'سجّل دخول الأول' });
    const body = await req.json().catch(() => ({}));
    const stage = body.stage === 'visit' ? 'visit' : 'credit';
    const { data: i, error } = await db.from('investigations').select('*').eq('id', body.investigation_id).single();
    if (error || !i) return out(404, { error: 'الاستعلام مش موجود أو مش مسموح لك تشوفه' });
    const K = checks(i, stage);
    // تاريخ العميل لو كان عميل قبل كده
    let hist: any = null;
    if (i.national_id) {
      const { data: cu } = await admin.from('customers').select('id').eq('tenant_id', i.tenant_id).eq('national_id', i.national_id).maybeSingle();
      if (cu) { const { data: cs } = await admin.from('cust_scores').select('risk,late_ratio,deferrals,legal,reasons').eq('customer_id', cu.id).maybeSingle(); hist = cs; if (cs) K.C.push({ ok: cs.risk < 40, t: `عميل سابق — درجة خطر ${cs.risk}/100${cs.reasons?.length ? ' (' + cs.reasons.join('، ') + ')' : ''}`, pts: Math.round((cs.risk || 0) * 0.35) + (cs.legal ? 25 : 0), sev: cs.risk >= 60 ? 'high' : 'mid' }); }
      const { data: prev } = await admin.from('investigations').select('status,credit_decision,created_at').eq('tenant_id', i.tenant_id).eq('national_id', i.national_id).neq('id', i.id);
      const rej = (prev || []).filter((x: any) => x.status === 'rejected').length;
      if (rej) K.C.push({ ok: false, t: `اترفض قبل كده ${rej} مرة`, pts: 12, sev: 'mid' });
    }
    // رأي الذكاء الاصطناعي (من غير أسماء ولا أرقام قومية ولا تليفونات)
    const f = i.visit_form || {}, strip = (p: any) => { const { name, phones, landline, ...r } = p || {}; return r; };
    const facts = { المرحلة: stage === 'visit' ? 'بعد الزيارة الميدانية' : 'بعد الاستعلام الائتماني (قبل الزيارة)', السن: K.N.age, النوع: K.N.gender, محافظة_الميلاد: K.N.gov, نوع_النشاط: i.occupation_type, الوظيفة: i.job_title, المهنة_في_البطاقة: i.id_data?.buyer?.job || null, الحالة_الاجتماعية_في_البطاقة: i.id_data?.buyer?.marital_status || null, جهة_العمل: i.employer_name, صافي_الدخل: i.net_income, دورية_الدخل: i.income_freq, الدخل_الشهري: K.inc, التزامات_شهرية: K.obl, القسط_المطلوب: K.inst, نسبة_الالتزام: K.dti != null ? Math.round(K.dti * 100) + '%' : null, السكن: i.housing, سنين_الإقامة: i.residence_years, ضامن_أول: i.guarantor1 ? { القرابة: i.guarantor1.relation } : null, ضامن_ثاني: i.guarantor2 ? { القرابة: i.guarantor2.relation } : null, تاريخ_سابق: hist, ...(stage === 'visit' ? { زيارة: { المشتري: strip(f.b), الضامن_الأول: strip(f.g1), الضامن_الثاني: strip(f.g2), السكن_مطابق: i.visit_verified, العمل_مطابق: i.visit_job_verified, تقرير_المستعلم: i.field_notes, نواقص: i.missing_items } } : {}), الفحوص_الآلية: K.C.map((c: any) => (c.ok === false ? '✗ ' : '✓ ') + c.t) };
    const prompt = `راجع طلب تقسيط ده بدقة وادي رأيك. البيانات:\n${JSON.stringify(facts)}\n\nرجّع JSON بالمفاتيح دي بالظبط (القيم بالعامية المصرية):\n{"income_estimate":{"min":رقم,"avg":رقم,"max":رقم,"note":"متوسط الدخل الشهري المعتاد بالجنيه لنفس الوظيفة/النشاط في مصر حاليًا ومدى منطقية الدخل المكتوب"},"income_plausible":"منطقي|مبالغ فيه|أقل من المعتاد|مش واضح","consistency":["تناقضات أو بيانات محتاجة تأكيد"],"risk_flags":["نقط خطر"],"positives":["نقط قوة"],"verify_next":["حاجات المستعلم أو الائتمان يتأكد منها"],"opinion":"approve|conditional|reject","confidence":رقم من 0 لـ 100,"summary":"ملخص في 3-4 سطور","claims":[{"key":"income|job|employer|residence|housing|obligations|guarantor","prob_true":رقم من 0 لـ 1 (احتمال إن البيان ده حقيقي حسب كل اللي قدامك),"why":"سبب قصير"}]}
لازم تحط claims للمفاتيح السبعة كلها.`;
    // رأيين مستقلين: محلل عادي + محلل متشكك. الاختلاف بينهم بيدخل كعدم يقين في السيناريوهات
    const skeptic = prompt.replace('راجع طلب تقسيط ده بدقة وادي رأيك.', 'انت محلل ائتمان متشكك جدًا ودورك تكتشف أي بيان ممكن يكون مش حقيقي. راجع طلب تقسيط ده.');
    const [ai, ai2]: any[] = await Promise.all([llm(prompt, admin, i.tenant_id), llm(skeptic, admin, i.tenant_id)]);
    const cl = (a: any) => { const o: Record<string, any> = {}; (Array.isArray(a?.claims) ? a.claims : []).forEach((c: any) => { const k = String(c.key || '').trim(); if (CLAIMS[k] && c.prob_true != null && !isNaN(+c.prob_true)) o[k] = { p: Math.max(0, Math.min(1, +c.prob_true > 1 ? +c.prob_true / 100 : +c.prob_true)), why: String(c.why || c[' why'] || '').slice(0, 200) }; }); return o; };
    const C1 = cl(ai), C2 = cl(ai2);
    const claims = Object.keys(CLAIMS).filter((k) => C1[k] || C2[k]).map((k) => { const a = C1[k], b = C2[k], p = a && b ? (a.p + b.p) / 2 : (a || b).p; return { key: k, label: CLAIMS[k], p: Math.round(p * 100) / 100, u: a && b ? Math.round(Math.abs(a.p - b.p) * 100) / 100 : 0.15, why: (a || b).why }; });
    let pts = K.C.reduce((s: number, c: any) => s + (c.pts || 0), 0);
    if (ai.opinion === 'reject') pts += 15; else if (ai.opinion === 'conditional') pts += 6;
    if (ai.income_plausible === 'مبالغ فيه') pts += 10;
    pts = Math.min(100, pts);
    const basePts = Math.min(100, K.C.reduce((s: number, c: any) => s + (c.pts || 0), 0));
    const D = decide(pts, K.inc, K.obl, K.inst);
    let robust: any = null;
    if (K.inc && K.inst) {
      const ie = ai.income_estimate || ai2.income_estimate || null;
      robust = robustDecide({ income: K.inc, obligations: K.obl || 0, inst: K.inst, points: basePts, claims: claims.map((c: any) => ({ key: c.key, p: c.p, u: c.u })), incEst: ie ? { min: num(ie.min) ?? undefined, avg: num(ie.avg) ?? undefined } : null });
      const ck = robust.chosen.key;
      D.decision = ck === 'reject' ? 'reject' : ck === 'approve' ? 'approve' : 'conditional';
      D.cond = ck === 'safe' ? [`تخفيض القسط لـ ${robust.chosen.inst} ج (أقصى قسط آمن)`] : ck === 'cond' ? [`زيادة المقدم بحيث القسط يبقى ${robust.chosen.inst} ج`, 'ضامن إضافي موظف بدخل ثابت'] : ck === 'strict' ? [`القسط ${robust.chosen.inst} ج بحد أقصى`, 'ضامن إضافي موظف بدخل ثابت', 'خطاب مفردات مرتب'] : ck === 'reject' ? [] : [];
      if (ck === 'reject') D.cond = [];
      D.pd = Math.round(robust.chosen.pd_mean * 100) || D.pd;
    }
    const result = { stage, points: pts, decision: D.decision, pd: D.pd, dti_cap: D.cap, max_installment: D.maxInst, requested_installment: K.inst, conditions: D.cond, checks: K.C, ai, ai2: ai2?.error ? { error: ai2.error } : { opinion: ai2?.opinion, confidence: ai2?.confidence, summary: ai2?.summary, model: ai2?.model }, claims, robust, at: new Date().toISOString() };
    await admin.from('inv_reviews').insert({ tenant_id: i.tenant_id, investigation_id: i.id, stage, decision: D.decision, points: pts, result, created_by: u.user.id });
    return out(200, result);
  } catch (e) { return out(200, { error: String(e) }); }
});
