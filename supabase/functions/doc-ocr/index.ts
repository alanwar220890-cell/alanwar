// الأنوار — قراءة صور البيعات والاستعلامات القديمة (الورق) بالذكاء الاصطناعي وإرجاع البيانات للمراجعة قبل الحفظ
import { createClient } from 'npm:@supabase/supabase-js@2';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const out = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const GOV: Record<string, string> = { '01': 'القاهرة', '02': 'الإسكندرية', '03': 'بورسعيد', '04': 'السويس', '11': 'دمياط', '12': 'الدقهلية', '13': 'الشرقية', '14': 'القليوبية', '15': 'كفر الشيخ', '16': 'الغربية', '17': 'المنوفية', '18': 'البحيرة', '19': 'الإسماعيلية', '21': 'الجيزة', '22': 'بني سويف', '23': 'الفيوم', '24': 'المنيا', '25': 'أسيوط', '26': 'سوهاج', '27': 'قنا', '28': 'أسوان', '29': 'الأقصر', '31': 'البحر الأحمر', '32': 'الوادي الجديد', '33': 'مطروح', '34': 'شمال سيناء', '35': 'جنوب سيناء', '88': 'خارج الجمهورية' };
const dig = (s: any) => String(s ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const clean = (s: any) => { const v = String(s ?? '').replace(/\s+/g, ' ').trim(); return v && !/^(null|غير واضح|unknown|n\/a|-)$/i.test(v) ? v : null; };
function isoDate(s: any) {
  const v = dig(s).trim(); if (!v) return null;
  let m = v.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = v.match(/^(\d{4})[\/\-.](\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-01`;
  return null;
}
function nid(n: string) {
  const r: any = { ok: false };
  if (!/^\d{14}$/.test(n)) { r.err = 'الرقم القومي المقروء مش 14 رقم — راجعه'; return r; }
  const c = n[0] === '2' ? 1900 : n[0] === '3' ? 2000 : 0, y = c + +n.slice(1, 3), m = +n.slice(3, 5), d = +n.slice(5, 7), dt = new Date(Date.UTC(y, m - 1, d));
  if (!c || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) { r.err = 'تاريخ الميلاد جوه الرقم القومي مش منطقي — غالبًا رقم اتقرا غلط'; return r; }
  r.birth_date = dt.toISOString().slice(0, 10); r.age = Math.floor((Date.now() - dt.getTime()) / 31557600000);
  r.gov = GOV[n.slice(7, 9)] || null; if (!r.gov) { r.err = 'كود المحافظة في الرقم القومي مش معروف — راجع الرقم'; return r; }
  r.gender = +n[12] % 2 ? 'ذكر' : 'أنثى'; r.ok = true; return r;
}

async function vision(imgs: { b64: string; mime: string }[], PROMPT: string, admin: any, tenant: string) {
  const okey = Deno.env.get('OPENAI_API_KEY'), gkey = Deno.env.get('GEMINI_API_KEY');
  if (!okey && !gkey) return { error: 'لسه مفيش مفتاح ذكاء اصطناعي (GEMINI_API_KEY) في Supabase' };
  const { data: row } = await admin.from('app_settings').select('value').eq('tenant_id', tenant).eq('key', 'ai_config').maybeSingle();
  const c = row?.value || {};
  const prov = c.provider === 'openai' && okey ? 'openai' : c.provider === 'gemini' && gkey ? 'gemini' : (okey ? 'openai' : 'gemini');
  const key = prov === 'openai' ? okey! : gkey!;
  const url = prov === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  let models = [(prov === 'openai' ? c.model : c.gemini_model) || (prov === 'openai' ? 'gpt-5.4-mini' : 'gemini-3.8-flash')];
  if (prov === 'gemini') { try { const l = await (await fetch('https://generativelanguage.googleapis.com/v1beta/openai/models', { headers: { Authorization: `Bearer ${key}` } })).json(); const all = (l?.data || []).map((x: any) => String(x.id).replace(/^models\//, '')).filter((x: string) => /^gemini/.test(x) && !/image|tts|audio|live|embed|preview|exp|thinking/.test(x)); const v = (x: string) => parseFloat((x.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0'); all.sort((a: string, b: string) => v(b) - v(a)); const fl = all.filter((x: string) => /flash/.test(x)), pro = all.filter((x: string) => /pro/.test(x)), pv = (l?.data || []).map((x: any) => String(x.id).replace(/^models\//, '')).filter((x: string) => /^gemini/.test(x) && /flash/.test(x) && /preview|latest/.test(x) && !/image|tts|audio|live|embed/.test(x)); models = [...new Set([...models, ...fl.slice(0, 8), ...pv.slice(0, 3), ...pro.slice(0, 2)])]; } catch (_) { /**/ } }
  let last = '', busy = 0; const t0 = Date.now();
  const one = async (m: string, ac: AbortController) => {
    const body: any = { model: m, messages: [{ role: 'system', content: 'انت نظام OCR دقيق جدًا لمستندات شركات البيع بالتقسيط في مصر (عقود، إيصالات أمانة، كمبيالات، استمارات استعلام، صور بطايق). رد بـ JSON بس.' }, { role: 'user', content: [{ type: 'text', text: PROMPT }, ...imgs.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.b64}` } }))] }], response_format: { type: 'json_object' } };
    if (prov === 'openai') body.max_completion_tokens = 4000; else { body.max_tokens = 4000; body.reasoning_effort = 'low'; }
    const r = await fetch(url, { method: 'POST', signal: ac.signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j0 = await r.json().catch(() => ({})); const j = Array.isArray(j0) ? j0[0] : j0;
    if (!r.ok) { const e = String(j?.error?.message || r.status); if (/demand|overload|unavailable|503|429/i.test(e + ' ' + r.status)) busy++; throw new Error(e); }
    const txt = j.choices?.[0]?.message?.content || ''; const mm = txt.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(mm ? mm[0] : txt);
    admin.from('ai_usage').insert({ tenant_id: tenant, user_id: null, model: prov + ':' + m + ':doc', prompt_tokens: j.usage?.prompt_tokens || 0, completion_tokens: j.usage?.completion_tokens || 0 }).then(() => {}, () => {});
    return { model: m, ...parsed };
  };
  // بنبعت لـ 3 موديلات مختلفة في نفس الوقت وأول واحد يرد صح بناخده ونلغي الباقي — أسرع وأقل تأثرًا بالزحمة
  const W = prov === 'openai' ? 1 : 3;
  for (let round = 0; round < 3 && Date.now() - t0 < 100000; round++) {
    for (let k = 0; k < models.length && Date.now() - t0 < 100000; k += W) {
      const grp = models.slice(k, k + W), ac = new AbortController();
      try { const res = await Promise.any(grp.map((m) => one(m, ac))); ac.abort(); return res; }
      catch (e: any) { const errs = (e?.errors || [e]).map((x: any) => String(x?.message || x)); last = errs[errs.length - 1] || last;
        if (errs.length && errs.every((x: string) => !/demand|overload|unavailable|503|429|500|not found|no longer|quota|exhausted|deadline|internal|JSON|Unexpected/i.test(x)) && prov === 'openai') return { error: last }; }
    }
    await new Promise((z) => setTimeout(z, 2000 * (round + 1)));
  }
  return { error: busy ? 'BUSY' : last };
}


const PC = `دي صور مستند بيعة بالتقسيط قديم من شركة في مصر (عقد بيع بالتقسيط و/أو إيصال أمانة و/أو كمبيالات و/أو كارت تحصيل و/أو صور بطايق المشتري والضامنين). الصور كلها لنفس البيعة. اقرا كل اللي مكتوب بدقة (خط إيد أو مطبوع) وطلّع JSON بس بالشكل ده:
{"contract_code":"رقم/كود العقد","contract_date":"تاريخ العقد YYYY-MM-DD","branch":"اسم الفرع لو مكتوب","seller":"اسم البائع/المندوب لو مكتوب",
"buyer":PERSON,"housing":"تمليك|إيجار قديم|إيجار جديد|null","monthly_income":رقم أو null,
"product":"اسم المنتج/السلعة","price":رقم سعر البيع الكلي أو null,"down_payment":رقم المقدم أو null,"months":عدد الأقساط/الشهور أو null,"installment":قيمة القسط الشهري أو null,"first_due_date":"تاريخ أول قسط YYYY-MM-DD أو null","annual_rate":نسبة الفائدة السنوية لو مكتوبة أو null,
"paid_installments_count":عدد الأقساط اللي باين إنها اتدفعت (من كارت التحصيل أو الإيصالات) أو null,"paid_amount":إجمالي المسدد من الأقساط لو مكتوب أو null,
"guarantor1":PERSON,"guarantor2":PERSON أو null,"notes":"أي ملاحظات مهمة مكتوبة على العقد","confidence":رقم من 0 لـ 100,"unclear":["الخانات اللي مش واضحة أو اتخمنت"]}
قواعد: حوّل الأرقام العربي لإنجليزي. المبالغ أرقام بس من غير عملة. ما تخترعش بيانات: أي حاجة مش ظاهرة حط null. لو السعر مش مكتوب بس القسط والمدة والمقدم مكتوبين سيبه null. الرقم القومي 14 رقم بالظبط ولو مش متأكد حط null واذكره في unclear.`.replace(/PERSON/g, '__P__');
const PI = `دي صور استمارة/طلب استعلام قديم لعميل في شركة بيع بالتقسيط في مصر (الطلب ده اتلغى أو اترفض) ومعاها ممكن صور بطايق. اقرا كل اللي مكتوب بدقة وطلّع JSON بس:
{"date":"تاريخ الطلب YYYY-MM-DD","branch":"الفرع لو مكتوب","buyer":PERSON,"birth_date":"YYYY-MM-DD أو null","housing":"تمليك|إيجار قديم|إيجار جديد|null","net_income":رقم الدخل الشهري أو null,"product":"المنتج المطلوب","new_installment":القسط المطلوب أو null,
"guarantor1":PERSON أو null,"guarantor2":PERSON أو null,"status":"cancelled|rejected|unknown","reason":"سبب الإلغاء أو الرفض لو مكتوب","notes":"ملاحظات","confidence":رقم من 0 لـ 100,"unclear":["الخانات اللي مش واضحة"]}
قواعد: الأرقام إنجليزي، ما تخترعش بيانات، أي حاجة مش ظاهرة null، الرقم القومي 14 رقم بالظبط أو null.`.replace(/PERSON/g, '__P__');
const num = (v: any) => { const s = dig(v).replace(/[,\s٬]/g, '').replace(/[^0-9.]/g, ''); return s === '' || isNaN(+s) ? null : +s; };
function person(p: any, warn: string[], lbl: string) {
  if (!p || typeof p !== 'object') return null;
  const o: any = { name: clean(p.name), national_id: null, phone: null, address: clean(p.address), id_address: clean(p.id_address), relation: clean(p.relation), job: clean(p.job), employer: clean(p.employer) };
  const n0 = dig(p.national_id).replace(/\D/g, ''); if (n0) { const N = nid(n0); if (N.ok) { o.national_id = n0; o.birth_date = N.birth_date; } else { o.national_id = n0; warn.push(lbl + ': ' + N.err); } }
  let ph = dig(p.phone).replace(/\D/g, ''); if (/^1\d{9}$/.test(ph)) ph = '0' + ph; if (/^20(1\d{9})$/.test(ph)) ph = '0' + ph.slice(2);
  if (ph) { o.phone = ph; if (!/^01[0125]\d{8}$/.test(ph)) warn.push(lbl + ': رقم الموبايل مش بصيغة مصرية صحيحة'); }
  return o.name || o.national_id ? o : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, auth = req.headers.get('Authorization') || '';
    const db = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: u } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    if (!u?.user) return out(401, { error: 'سجّل دخول الأول' });
    const { data: perms } = await db.rpc('my_perms');
    const P: string[] = perms || [];
    const body = await req.json().catch(() => ({}));
    const kind = body.kind === 'inquiry' ? 'inquiry' : 'contract';
    if (!(P.includes('con.import') || (kind === 'inquiry' && P.includes('inv.create')))) return out(403, { error: 'مش مسموحلك تستورد ' + (kind === 'inquiry' ? 'استعلامات' : 'عقود') });
    const { data: me } = await admin.from('profiles').select('tenant_id').eq('id', u.user.id).single();
    const imgs = (Array.isArray(body.images) ? body.images : []).slice(0, 6).filter((i: any) => i && typeof i.b64 === 'string' && /^image\/(jpeg|png|webp)$/.test(i.mime || ''));
    if (!imgs.length) return out(400, { error: 'صوّر البيعة الأول' });
    if (imgs.reduce((s: number, i: any) => s + i.b64.length, 0) > 18_000_000) return out(400, { error: 'الصور كبيرة جدًا، قلّل عددها' });
    const PS = '__P__', PJ = '__PJ__';
    const r: any = await vision(imgs, (kind === 'inquiry' ? PI : PC).split(PS).join(PJ).replace(/__PJ__/g, '{"name":"الاسم كامل","national_id":"14 رقم","phone":"موبايل 11 رقم","address":"العنوان","id_address":"عنوان البطاقة لو مكتوب","relation":"صلة القرابة بالمشتري (للضامن)","job":"المهنة","employer":"جهة العمل"}'), admin, me!.tenant_id);
    if (r.error) return out(200, r.error === 'BUSY' ? { error: 'خدمة الذكاء الاصطناعي عليها ضغط كبير دلوقتي ومش فاضية. جرّب تاني بعد دقيقتين.', busy: true } : { error: 'الذكاء الاصطناعي ما قدرش يقرا الصور: ' + r.error });
    const warn: string[] = [];
    const res: any = { kind, model: r.model, confidence: r.confidence != null ? +r.confidence : null, unclear: Array.isArray(r.unclear) ? r.unclear.map(clean).filter(Boolean).slice(0, 15) : [], notes: clean(r.notes), branch: clean(r.branch),
      buyer: person(r.buyer, warn, 'المشتري'), guarantor1: person(r.guarantor1, warn, 'الضامن الأول'), guarantor2: person(r.guarantor2, warn, 'الضامن الثاني'), housing: clean(r.housing) };
    if (kind === 'contract') Object.assign(res, { contract_code: clean(r.contract_code), contract_date: isoDate(r.contract_date), seller: clean(r.seller), monthly_income: num(r.monthly_income), product: clean(r.product),
      price: num(r.price), down_payment: num(r.down_payment), months: num(r.months), installment: num(r.installment), first_due_date: isoDate(r.first_due_date), annual_rate: num(r.annual_rate),
      paid_installments_count: num(r.paid_installments_count), paid_amount: num(r.paid_amount) });
    else Object.assign(res, { date: isoDate(r.date), birth_date: isoDate(r.birth_date), net_income: num(r.net_income), product: clean(r.product), new_installment: num(r.new_installment), status: r.status === 'rejected' ? 'rejected' : 'cancelled', reason: clean(r.reason) });
    if (kind === 'contract') {
      if (res.price == null && res.installment && res.months) res.price_calc = Math.round((res.installment * res.months + (res.down_payment || 0)) * 100) / 100;
      if (res.paid_amount == null && res.paid_installments_count != null && res.installment) res.paid_amount = Math.round(res.paid_installments_count * res.installment * 100) / 100;
      if (!res.buyer) warn.push('مش لاقي بيانات المشتري في الصور');
      if (!res.contract_date) warn.push('تاريخ العقد مش واضح');
    }
    if (res.confidence != null && res.confidence < 70) warn.push('ثقة القراءة ' + res.confidence + '% — راجع كل الخانات كويس');
    res.warnings = warn;
    return out(200, res);
  } catch (e) { return out(500, { error: String((e as Error).message || e) }); }
});
