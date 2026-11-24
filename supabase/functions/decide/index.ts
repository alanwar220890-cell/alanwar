// الأنوار — محرك القرار: الذكاء الاصطناعي بيطلّع أفكار وبدائل، ونماذج بحوث العمليات بتحسبها على بيانات الشركة وتختار الأفضل.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { dealSolve, collectSolve, calibrate, targetsSolve, mcdaSolve, clamp, ACT, type DealOpt, type Debt, type Coll, type Unit, type Crit } from './or.ts';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const out = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const num = (v: any, d = 0) => (v == null || v === '' || isNaN(+v) ? d : +v);

async function llm(admin: any, tenant: string, sys: string, user: string, temp = 0.4, maxTok = 3500): Promise<any> {
  const okey = Deno.env.get('OPENAI_API_KEY'), gkey = Deno.env.get('GEMINI_API_KEY');
  if (!okey && !gkey) return { error: 'لسه مفيش مفتاح ذكاء اصطناعي' };
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
      const body: any = { model: m, messages: [{ role: 'system', content: sys + ' رد بـ JSON بس من غير أي كلام قبله أو بعده.' }, { role: 'user', content: user }], response_format: { type: 'json_object' } };
      if (prov === 'openai') body.max_completion_tokens = maxTok; else { body.max_tokens = maxTok; body.reasoning_effort = 'low'; body.temperature = temp; }
      const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j0 = await r.json().catch(() => ({})); const j = Array.isArray(j0) ? j0[0] : j0;
      if (r.ok) {
        const txt = j.choices?.[0]?.message?.content || '';
        await admin.from('ai_usage').insert({ tenant_id: tenant, user_id: null, model: prov + ':' + m + ':decide', prompt_tokens: j.usage?.prompt_tokens || 0, completion_tokens: j.usage?.completion_tokens || 0 });
        const mm = txt.match(/\{[\s\S]*\}/); try { return { model: m, ...JSON.parse(mm ? mm[0] : txt) }; } catch (_) { return { error: 'رد الذكاء الاصطناعي مش مفهوم' }; }
      }
      last = String(j?.error?.message || r.status);
      if (prov === 'openai' || !/demand|overload|unavailable|503|429|not found|no longer|quota|exhausted/i.test(last + r.status)) return { error: last };
      if (t === 0) await new Promise((z) => setTimeout(z, 1200));
    }
  }
  return { error: last };
}
const SYS = 'انت مستشار خبير لشركة بيع بالتقسيط في مصر (أجهزة وإلكترونيات). بتكتب بالعامية المصرية باختصار ووضوح.';

// ============ 1) هيكلة بيعة ============
async function deal(db: any, admin: any, me: any, b: any) {
  let inc = num(b.income), obl = num(b.obligations), pts = b.points != null ? num(b.points) : null, label = b.label || '';
  if (b.investigation_id) {
    const { data: i } = await db.from('investigations').select('customer_name,monthly_income,net_income,obligations_monthly,job_title,housing').eq('id', b.investigation_id).single();
    if (!i) throw new Error('الاستعلام مش موجود أو مش مسموح لك');
    inc = inc || num(i.monthly_income ?? i.net_income); obl = b.obligations != null && b.obligations !== '' ? obl : num(i.obligations_monthly); label = label || i.customer_name;
    const { data: rv } = await db.from('inv_reviews').select('points,stage,created_at').eq('investigation_id', b.investigation_id).order('created_at', { ascending: false }).limit(1);
    if (pts == null && rv?.[0]) pts = num(rv[0].points);
  }
  if (!(inc > 0)) throw new Error('اكتب دخل العميل الشهري');
  const price = num(b.price); if (!(price > 0)) throw new Error('اكتب سعر المنتج');
  let rate = num(b.rate, -1), method = b.method || 'flat';
  if (rate < 0 && b.product_id) { const { data: p } = await db.from('products').select('annual_rate').eq('id', b.product_id).single(); rate = num(p?.annual_rate, 0); }
  if (rate < 0) rate = 0;
  if (pts == null) pts = 30;
  const ctx = { price, rate, method, income: inc, obligations: obl, points: pts, pdMax: clamp(num(b.pd_max, 25), 5, 60) / 100, maxMonths: clamp(num(b.max_months, 36), 3, 60), minDownPct: clamp(num(b.min_down, 0), 0, 90) };
  // الذكاء الاصطناعي: أفكار هياكل إضافية (بتتحسب زي أي اختيار تاني، مش بتتقبل لوحدها)
  const ai = await llm(admin, me.tenant_id, SYS, `عميل دخله ${inc} ج والتزاماته ${obl} ج، نقط خطره ${pts}/100، عايز يشتري منتج بـ ${price} ج والفايدة السنوية ${rate}% (${method === 'flat' ? 'ثابتة' : 'متناقصة'}). ${b.notes ? 'ملاحظات: ' + String(b.notes).slice(0, 400) : ''}
اقترح من 6 لـ 12 هيكل بيعة مختلفين ومبتكرين. رجّع JSON: {"ideas":[{"down_pct":0-50,"months":3-36,"rate_pct":رقم,"extra_guarantor":true|false,"salary_letter":true|false,"why":"سبب قصير"}],"tips":["نصايح تفاوض مع العميل"]}`, 0.8);
  const extra: DealOpt[] = (ai.ideas || []).slice(0, 15).map((x: any) => ({ downPct: clamp(Math.round(num(x.down_pct) / 5) * 5, 0, 50), months: clamp(Math.round(num(x.months, 12)), 3, ctx.maxMonths), rate: clamp(num(x.rate_pct, rate), rate * 0.7, rate * 1.2), guarantor: !!x.extra_guarantor, salary: !!x.salary_letter }));
  const r = dealSolve(ctx, extra);
  return { kind: 'deal', label, ctx, ...r, ai_ideas: (ai.ideas || []).length, tips: ai.tips || [], ai_error: ai.error || null, model: ai.model || null };
}

// ============ 2) خطة التحصيل ============
async function collect(db: any, admin: any, me: any, b: any) {
  let q = db.from('v_delinquency').select('contract_id,branch_id,customer_id,days_late,overdue_amount').gt('days_late', 0).order('overdue_amount', { ascending: false }).limit(400);
  if (b.branch_id) q = q.eq('branch_id', b.branch_id);
  const { data: V, error } = await q; if (error) throw new Error(error.message);
  const L = (V || []).filter((x: any) => x.overdue_amount > 0);
  const cids = [...new Set(L.map((x: any) => x.customer_id))];
  const [cu, sc, cl, rr] = await Promise.all([
    cids.length ? db.from('customers').select('id,full_name,phone,zones(name)').in('id', cids) : { data: [] },
    cids.length ? db.from('cust_scores').select('customer_id,risk').in('customer_id', cids) : { data: [] },
    db.rpc('decide_collectors'), db.rpc('decide_recovery_rates'),
  ]);
  const CU: any = {}, SC: any = {}; (cu.data || []).forEach((x: any) => CU[x.id] = x); (sc.data || []).forEach((x: any) => SC[x.customer_id] = x.risk);
  let cols: Coll[] = (cl.data || []).map((x: any) => ({ id: x.id, name: x.full_name, branch_id: x.branch_id }));
  if (b.branch_id) cols = cols.filter((c) => !c.branch_id || c.branch_id === b.branch_id);
  if (!cols.length) throw new Error('مفيش محصلين متاحين في النطاق ده');
  const debts: Debt[] = L.map((x: any) => ({ id: x.contract_id, branch_id: x.branch_id, days: x.days_late, amount: +x.overdue_amount, risk: SC[x.customer_id] ?? 30, name: CU[x.customer_id]?.full_name, phone: CU[x.customer_id]?.phone, zone: CU[x.customer_id]?.zones?.name }));
  const cal = calibrate(rr.data || {}), cap = { call: clamp(num(b.calls, 40), 1, 300), wa: clamp(num(b.wa, 100), 0, 1000), visit: clamp(num(b.visits, 6), 0, 50) };
  const plans = (['max', 'balanced', 'legal'] as const).map((v) => collectSolve(debts, cols, cap, cal.rate, v));
  const NM: any = { max: 'أعلى تحصيل متوقع', balanced: 'توزيع متوازن على المحصلين', legal: 'أولوية منع التحويل للشؤون' };
  plans.forEach((p: any) => p.name = NM[p.variant]);
  const bk = { b1: 0, b2: 0, b3: 0, b4: 0 } as any; debts.forEach((d) => { bk[d.days <= 30 ? 'b1' : d.days <= 60 ? 'b2' : d.days <= 90 ? 'b3' : 'b4']++; });
  const ai = await llm(admin, me.tenant_id, SYS, `عندنا ${debts.length} عميل متأخر: ${bk.b1} من 1-30 يوم، ${bk.b2} من 31-60، ${bk.b3} من 61-90، ${bk.b4} أكتر من 90. إجمالي المتأخر ${Math.round(debts.reduce((s, d) => s + d.amount, 0))} ج.
الأفعال المتاحة: ${Object.values(ACT).map((a) => a.name).join('، ')}.
اكتب لكل فعل نص قصير مقنع ومحترم يتقال للعميل، واقترح أفكار إضافية لزيادة التحصيل. رجّع JSON: {"scripts":{"wa":"...","call":"...","settle":"...","legalw":"...","visit":"..."},"ideas":["..."]}`, 0.7);
  return { kind: 'collect', calibration: cal, cap, collectors: cols.length, plans: plans.sort((a: any, b: any) => b.expected - a.expected), scripts: ai.scripts || {}, ideas: ai.ideas || [], ai_error: ai.error || null, model: ai.model || null };
}

// ============ 3) توزيع التارجت ============
async function targets(db: any, admin: any, me: any, b: any) {
  const T = num(b.total); if (!(T > 0)) throw new Error('اكتب التارجت الإجمالي');
  const level = b.level === 'employee' ? 'employee' : 'branch';
  const { data: H, error } = await db.rpc('decide_sales_hist', { p_months: 12 }); if (error) throw new Error(error.message);
  const now = new Date(), months: string[] = []; for (let i = 12; i >= 1; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); months.push(d.toISOString().slice(0, 10)); }
  const rows = (H || []).filter((x: any) => level === 'branch' || x.branch_id === b.branch_id);
  const key = (x: any) => level === 'branch' ? x.branch_id : x.user_id;
  const ids = [...new Set(rows.map(key).filter(Boolean))] as string[];
  let names: any = {};
  if (level === 'branch') { const { data } = await db.from('branches').select('id,name'); (data || []).forEach((x: any) => names[x.id] = x.name); (data || []).forEach((x: any) => { if (!ids.includes(x.id) && (!b.branch_ids || b.branch_ids.includes(x.id))) ids.push(x.id); }); }
  else { const { data } = await db.from('profiles').select('id,full_name,email'); (data || []).forEach((x: any) => names[x.id] = x.full_name || x.email); }
  const use = b.branch_ids && level === 'branch' ? ids.filter((i) => b.branch_ids.includes(i)) : ids;
  if (!use.length) throw new Error('مفيش بيانات مبيعات كفاية للتوزيع');
  const units: Unit[] = use.map((id) => ({ id, name: names[id] || '—', series: months.map((m) => rows.filter((x: any) => key(x) === id && x.month === m).reduce((s: number, x: any) => s + +x.sales, 0)) }));
  const r = targetsSolve(units, T, clamp(num(b.min_growth, 80), 0, 100) / 100, clamp(num(b.max_growth, 160), 100, 400) / 100);
  const ai = await llm(admin, me.tenant_id, SYS, `هنوزع تارجت مبيعات ${T} ج على ${units.length} ${level === 'branch' ? 'فرع' : 'موظف'}. أفضل توزيع محسوب: ${JSON.stringify(r.schemes[0].rows.map((x: any) => ({ n: x.name, t: x.target, f: x.forecast, p: x.prob })))}.
اقترح أفكار عملية تساعد كل وحدة ضعيفة الاحتمال توصل للتارجت. رجّع JSON: {"ideas":["..."],"per_unit":[{"name":"...","advice":"..."}]}`, 0.6);
  return { kind: 'targets', level, month: b.month || null, ...r, ideas: ai.ideas || [], per_unit: ai.per_unit || [], ai_error: ai.error || null, model: ai.model || null };
}

// ============ 4) أي سؤال إداري ============
async function general(db: any, admin: any, me: any, b: any) {
  const q = String(b.question || '').trim(); if (q.length < 8) throw new Error('اكتب السؤال بالتفصيل');
  // لقطة أرقام حقيقية من بيانات الشركة (في نطاق صلاحيات المستخدم) علشان الأفكار تبقى مبنية على الواقع
  const d30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const [del, pay, con, kp] = await Promise.all([
    db.from('v_delinquency').select('days_late,overdue_amount').gt('days_late', 0).limit(2000),
    db.from('payments').select('amount').gte('paid_at', d30).limit(5000),
    db.from('contracts').select('status,price,start_date').limit(5000),
    db.from('kpi_daily').select('day,kind,data').order('day', { ascending: false }).limit(3),
  ]);
  const D = del.data || [], C = con.data || [];
  const snap = {
    عقود_سارية: C.filter((x: any) => x.status === 'active').length, عقود_شؤون: C.filter((x: any) => x.status === 'legal').length,
    مبيعات_آخر_30_يوم: Math.round(C.filter((x: any) => x.start_date && x.start_date >= d30.slice(0, 10)).reduce((s: number, x: any) => s + +x.price, 0)),
    تحصيل_آخر_30_يوم: Math.round((pay.data || []).reduce((s: number, x: any) => s + +x.amount, 0)),
    عملاء_متأخرين: D.length, إجمالي_المتأخر: Math.round(D.reduce((s: number, x: any) => s + +x.overdue_amount, 0)),
    متأخر_أكتر_من_60_يوم: D.filter((x: any) => x.days_late > 60).length, مؤشرات: (kp.data || [])[0]?.data || null,
  };
  const g = await llm(admin, me.tenant_id, SYS + ' بتفكر بطريقة منهجية وبتطلّع بدائل متنوعة جدًا.', `السؤال: ${q}
أرقام الشركة الحالية: ${JSON.stringify(snap)}
1) طلّع من 10 لـ 15 بديل/فكرة مختلفة فعلًا لحل السؤال (مش تكرار لنفس الفكرة).
2) حدد من 4 لـ 6 معايير للمفاضلة (زي: العائد المتوقع، التكلفة، المخاطرة، سرعة التنفيذ، سهولة التطبيق، الأثر على العملاء) مع وزن كل معيار من 1 لـ 10 حسب أهميته للسؤال ده، ونوعه benefit (كل ما يزيد أحسن) أو cost (كل ما يقل أحسن).
رجّع JSON: {"alternatives":[{"id":"a1","title":"عنوان قصير","desc":"شرح في سطرين","steps":["خطوة 1","خطوة 2"]}],"criteria":[{"key":"c1","name":"...","weight":1-10,"dir":"benefit|cost"}]}`, 0.9, 5000);
  if (g.error) throw new Error('الذكاء الاصطناعي ما ردش: ' + g.error);
  const alts = (g.alternatives || []).slice(0, 15).map((a: any, i: number) => ({ id: 'a' + (i + 1), title: String(a.title || '').slice(0, 120), desc: String(a.desc || '').slice(0, 400), steps: (a.steps || []).slice(0, 6) }));
  const crit: Crit[] = (g.criteria || []).slice(0, 6).map((c: any, i: number) => ({ key: 'c' + (i + 1), name: String(c.name || '').slice(0, 60), weight: clamp(num(c.weight, 5), 1, 10), dir: c.dir === 'cost' ? 'cost' : 'benefit' }));
  if (alts.length < 3 || crit.length < 2) throw new Error('الذكاء الاصطناعي ما طلّعش بدائل كفاية، جرّب تاني');
  const ask = `السؤال: ${q}\nأرقام الشركة: ${JSON.stringify(snap)}\nالبدائل: ${JSON.stringify(alts.map((a: any) => ({ id: a.id, t: a.title, d: a.desc })))}\nالمعايير: ${JSON.stringify(crit.map((c) => ({ key: c.key, n: c.name, dir: c.dir })))}\nقيّم كل بديل على كل معيار من 1 لـ 10 بدقة وبشكل مستقل (في معيار cost: الرقم الأعلى = تكلفة/مخاطرة أعلى). رجّع JSON: {"scores":{"a1":{"c1":رقم,...},...},"notes":{"a1":"سبب مختصر للتقييم"}}`;
  // تقييمين مستقلين؛ الاختلاف بينهم بيتحسب كعدم يقين في المحاكاة
  const [s1, s2] = await Promise.all([llm(admin, me.tenant_id, SYS + ' انت مقيّم صارم ومحايد.', ask, 0.2), llm(admin, me.tenant_id, SYS + ' انت مقيّم متشكك بيدور على المخاطر.', ask, 0.6)]);
  const mat = (s: any) => s?.scores ? alts.map((a: any) => crit.map((c) => clamp(num(s.scores?.[a.id]?.[c.key], 5), 1, 10))) : null;
  const M1 = mat(s1), M2 = mat(s2);
  if (!M1 && !M2) throw new Error('تعذر تقييم البدائل: ' + (s1.error || s2.error || ''));
  const r = mcdaSolve(alts.map((a: any) => ({ ...a, note: s1?.notes?.[a.id] || s2?.notes?.[a.id] || '' })), crit, (M1 || M2)!, M1 && M2 ? M2 : null, 3000);
  return { kind: 'general', question: q, snapshot: snap, criteria: crit, ...r, model: g.model || null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, auth = req.headers.get('Authorization') || '';
    const db = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: u } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    if (!u?.user) return out(401, { error: 'سجّل دخول الأول' });
    const { data: me } = await admin.from('profiles').select('id,tenant_id,role,active').eq('id', u.user.id).single();
    const { data: perms } = await db.rpc('my_perms');
    const P: string[] = perms || [], can = (...k: string[]) => me?.role === 'system_admin' || k.some((x) => P.includes(x));
    if (!me?.active || !P.length && me?.role !== 'system_admin') return out(403, { error: 'غير مصرح' });
    const b = await req.json().catch(() => ({}));
    const kind = String(b.kind || '');
    let res: any;
    if (kind === 'deal') { if (!can('inv.view', 'inv.credit', 'con.create', 'con.credit')) return out(403, { error: 'مش مسموح لك' }); res = await deal(db, admin, me, b); }
    else if (kind === 'collect') { if (!can('coll.view')) return out(403, { error: 'مش مسموح لك' }); res = await collect(db, admin, me, b); }
    else if (kind === 'targets') { if (!can('tgt.edit', 'tgt.view', 'fin.view')) return out(403, { error: 'مش مسموح لك' }); res = await targets(db, admin, me, b); }
    else if (kind === 'general') { if (!can('ai.view')) return out(403, { error: 'مش مسموح لك' }); res = await general(db, admin, me, b); }
    else return out(400, { error: 'نوع القرار مش معروف' });
    res.at = new Date().toISOString();
    const { data: saved } = await admin.from('decisions').insert({ tenant_id: me.tenant_id, user_id: me.id, kind, question: String(b.question || b.label || '').slice(0, 500) || null, input: b, result: res }).select('id').single();
    res.id = saved?.id || null;
    return out(200, res);
  } catch (e) { return out(200, { error: String((e as Error).message || e) }); }
});
