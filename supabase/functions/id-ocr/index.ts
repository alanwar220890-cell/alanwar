// الأنوار — قراءة البطاقة الشخصية المصرية (وجه/ظهر) بالذكاء الاصطناعي وإرجاع البيانات للمراجعة والتعديل
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
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

const PROMPT = `دي صورة بطاقة رقم قومي مصرية (ممكن تكون الوش أو الضهر). اقرا كل اللي مكتوب بدقة وطلّع JSON بس بالشكل ده:
{"side":"front"|"back"|"unknown","is_egyptian_id":true|false,"name":"الاسم الكامل كما هو (سطر الاسم الأول + السطر التاني)","address":"العنوان كما هو في البطاقة (السطرين مع بعض)","national_id":"14 رقم بالأرقام الإنجليزي","job":"المهنة كما هي في الضهر","workplace":"جهة العمل لو مكتوبة","gender":"ذكر/أنثى","religion":"الديانة","marital_status":"الحالة الاجتماعية (أعزب/متزوج/مطلق/أرمل...)","spouse_name":"اسم الزوج/الزوجة لو مكتوب","issue_date":"تاريخ الإصدار YYYY-MM-DD أو YYYY-MM","expiry_date":"البطاقة سارية حتى YYYY-MM-DD","quality":"good|blurry|cropped|glare","confidence":0-100,"notes":"أي ملاحظة: حاجة مش واضحة، تعديل باليد، صورة صورة..."}
قواعد: حوّل الأرقام العربي (٠١٢٣٤٥٦٧٨٩) لأرقام إنجليزي. ما تخمنش؛ أي خانة مش ظاهرة أو مش واضحة حط null. الرقم القومي 14 رقم بالظبط ولو مش متأكد من رقم فيه اكتب null في national_id واشرح في notes. الاسم والعنوان بالعربي زي ما هما من غير تصحيح.`;

async function vision(b64: string, mime: string, admin: any, tenant: string) {
  const okey = Deno.env.get('OPENAI_API_KEY'), gkey = Deno.env.get('GEMINI_API_KEY');
  if (!okey && !gkey) return { error: 'لسه مفيش مفتاح ذكاء اصطناعي (GEMINI_API_KEY) في Supabase' };
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
      const body: any = { model: m, messages: [{ role: 'system', content: 'انت نظام OCR دقيق للبطاقات الشخصية المصرية. رد بـ JSON بس.' }, { role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }] }], response_format: { type: 'json_object' } };
      if (prov === 'openai') body.max_completion_tokens = 1500; else { body.max_tokens = 1500; body.reasoning_effort = 'low'; }
      const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j0 = await r.json().catch(() => ({})); const j = Array.isArray(j0) ? j0[0] : j0;
      if (r.ok) {
        const txt = j.choices?.[0]?.message?.content || '';
        await admin.from('ai_usage').insert({ tenant_id: tenant, user_id: null, model: prov + ':' + m + ':ocr', prompt_tokens: j.usage?.prompt_tokens || 0, completion_tokens: j.usage?.completion_tokens || 0 });
        const mm = txt.match(/\{[\s\S]*\}/); try { return { model: m, ...JSON.parse(mm ? mm[0] : txt) }; } catch (_) { return { error: 'الرد مش مفهوم، جرّب صورة أوضح' }; }
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
    // التحقق من الصلاحية: المستخدم لازم يشوف المستند ده بصلاحياته هو (RLS)
    const { data: doc } = await db.from('investigation_docs').select('id,investigation_id,doc_type,file_path').eq('file_path', String(body.path || '')).maybeSingle();
    if (!doc) return out(404, { error: 'المستند مش موجود أو مش مسموح لك' });
    const { data: inv } = await db.from('investigations').select('tenant_id').eq('id', doc.investigation_id).single();
    if (!inv) return out(404, { error: 'الاستعلام مش موجود' });
    const { data: blob, error: de } = await db.storage.from('inv-docs').download(doc.file_path);
    if (de || !blob) return out(400, { error: 'تعذر تحميل الصورة' });
    const mime = blob.type && blob.type.startsWith('image/') ? blob.type : /\.png$/i.test(doc.file_path) ? 'image/png' : /\.webp$/i.test(doc.file_path) ? 'image/webp' : 'image/jpeg';
    if (/pdf/i.test(blob.type) || /\.pdf$/i.test(doc.file_path)) return out(400, { error: 'القراءة الآلية للصور بس (مش PDF)' });
    if (blob.size > 12 * 1024 * 1024) return out(400, { error: 'الصورة كبيرة جدًا' });
    const b64 = encodeBase64(new Uint8Array(await blob.arrayBuffer()));
    const r: any = await vision(b64, mime, admin, inv.tenant_id);
    if (r.error) return out(200, { error: 'الذكاء الاصطناعي ما قدرش يقرا البطاقة: ' + r.error });
    const res: any = {
      doc_type: doc.doc_type, side: r.side || 'unknown', is_id: r.is_egyptian_id !== false, model: r.model,
      name: clean(r.name), address: clean(r.address), national_id: null as string | null, job: clean(r.job), workplace: clean(r.workplace),
      gender: clean(r.gender), religion: clean(r.religion), marital_status: clean(r.marital_status), spouse_name: clean(r.spouse_name),
      issue_date: isoDate(r.issue_date), expiry_date: isoDate(r.expiry_date), quality: r.quality || null,
      confidence: r.confidence != null ? +r.confidence : null, notes: clean(r.notes), warnings: [] as string[],
    };
    const n0 = dig(r.national_id).replace(/\D/g, ''); res.national_id = n0 || null;
    if (res.national_id) {
      const N = nid(res.national_id);
      if (N.ok) { res.birth_date = N.birth_date; res.age = N.age; res.birth_gov = N.gov; res.nid_gender = N.gender; if (res.gender && res.gender !== N.gender) res.warnings.push(`النوع المكتوب (${res.gender}) مش مطابق للرقم القومي (${N.gender})`); }
      else res.warnings.push(N.err);
    }
    if (!res.is_id) res.warnings.push('الصورة دي مش باينة إنها بطاقة رقم قومي مصرية');
    if (res.expiry_date && res.expiry_date < new Date().toISOString().slice(0, 10)) res.warnings.push('البطاقة منتهية (سارية حتى ' + res.expiry_date + ')');
    if (res.quality && res.quality !== 'good') res.warnings.push('جودة الصورة: ' + (({ blurry: 'مهزوزة', cropped: 'متقصوصة', glare: 'فيها انعكاس' } as any)[res.quality] || res.quality));
    if (res.confidence != null && res.confidence < 70) res.warnings.push('ثقة القراءة ' + res.confidence + '% — راجع البيانات كويس');
    return out(200, res);
  } catch (e) { return out(500, { error: String((e as Error).message || e) }); }
});
