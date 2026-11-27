// الأنوار — تدريب الموظفين بالذكاء الاصطناعي على منهج أفضل موظف في نفس الوظيفة
import { createClient } from 'npm:@supabase/supabase-js@2';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const out = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const ROLE: Record<string, string> = { sales: 'موظف مبيعات (بيع بالتقسيط)', collector: 'موظف تحصيل أقساط', branch_manager: 'مدير فرع' };
const SCEN: Record<string, string> = {
  sales: 'انت عميل مصري جاي المعرض أو بيكلم على الواتساب عايز يشتري موبايل أو جهاز بالتقسيط. عندك تردد (السعر، المقدم، الفايدة، الضامن، المقارنة بمحل تاني). اتكلم بالعامية المصرية بشكل طبيعي وواقعي، ومتقبلش بسهولة لو الموظف مقنعكش.',
  collector: 'انت عميل مصري متأخر في قسطين أو تلاتة. عندك أعذار (ظروف شغل، مرض، نسيان) وأحيانًا بتتهرب أو بتتعصب. اتكلم بالعامية المصرية بشكل واقعي، واستجيب لو الموظف تعامل باحترافية واتفق معاك على ميعاد ومبلغ واضح.',
  branch_manager: 'انت موظف في فرع (مبيعات أو تحصيل) أو موقف إداري في الفرع: التارجت متأخر، أو موظف بيتأخر، أو خلاف مع عميل. اتكلم بالعامية المصرية بشكل واقعي، والمدير لازم يتصرف بحسم واحترام ويحط خطة واضحة.',
};
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, auth = req.headers.get('Authorization') || '';
    const db = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: u } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    if (!u?.user) return out(401, { error: 'سجّل دخول الأول' });
    const { data: me } = await admin.from('profiles').select('id,tenant_id,full_name,role,active').eq('id', u.user.id).single();
    if (!me?.active) return out(403, { error: 'حسابك مش مفعّل' });
    const P: string[] = (await db.rpc('my_perms')).data || [];
    if (me.role !== 'system_admin' && !P.includes('ai.train')) return out(403, { error: 'التدريب مش مفعّل ليك. كلم المدير العام.' });
    const b = await req.json().catch(() => ({}));
    const role = ROLE[b.role] ? b.role : 'sales', action = ['lesson', 'roleplay', 'evaluate', 'ask'].includes(b.action) ? b.action : 'lesson';
    const { data: pbRow } = await admin.from('app_settings').select('value').eq('tenant_id', me.tenant_id).eq('key', 'train_playbook').maybeSingle();
    const pb = (pbRow?.value || {})[role] || {};
    if (!String(pb.method || '').trim()) return out(200, { error: 'لسه منهج «أفضل ' + ROLE[role] + '» متسجلش. المدير العام أو الـ HR يكتبه الأول من «منهج أفضل موظف».' });
    const okey = Deno.env.get('OPENAI_API_KEY'), gkey = Deno.env.get('GEMINI_API_KEY');
    if (!okey && !gkey) return out(200, { error: 'مفيش مفتاح ذكاء اصطناعي في Supabase' });
    const { data: cr } = await admin.from('app_settings').select('value').eq('tenant_id', me.tenant_id).eq('key', 'ai_config').maybeSingle();
    const c = cr?.value || {};
    const prov = c.provider === 'openai' && okey ? 'openai' : c.provider === 'gemini' && gkey ? 'gemini' : (gkey ? 'gemini' : 'openai');
    const key = prov === 'openai' ? okey! : gkey!, ep = prov === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    const model = (prov === 'openai' ? c.model : c.gemini_model) || (prov === 'openai' ? 'gpt-5.4-mini' : 'gemini-3.8-flash');
    const base = `انت مدرب محترف في شركة "الأنوار" للبيع بالتقسيط في مصر. بتدرب ${ROLE[role]} اسمه ${me.full_name || ''}.
التدريب لازم يكون مبني على منهج وأسلوب أفضل ${ROLE[role]} في الشركة${pb.best_name ? ' (' + pb.best_name + ')' : ''}، زي ما الإدارة كتبته بالظبط:
"""${String(pb.method).slice(0, 6000)}"""
${pb.stats ? 'أرقام أداء أفضل موظف (للاسترشاد): ' + String(pb.stats).slice(0, 1500) : ''}
اتكلم بالعامية المصرية، بأسلوب عملي ومشجع، ومن غير ما تخترع سياسات أو أرقام مش موجودة في المنهج.`;
    const hist = (Array.isArray(b.messages) ? b.messages : []).slice(-20).map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 2000) }));
    let msgs: any[];
    if (action === 'lesson') msgs = [{ role: 'system', content: base }, { role: 'user', content: `اعملي درس تدريبي النهارده (حوالي 5 دقايق قراية) بالعناوين دي:
## الفكرة الأساسية
## خطوات أفضل موظف خطوة بخطوة
## جمل وعبارات جاهزة أقولها (من المنهج)
## أخطاء شائعة لازم أتجنبها
## تمرين سريع: 3 أسئلة اختيار من متعدد (والإجابة الصح في الآخر)
${b.topic ? 'ركّز على: ' + String(b.topic).slice(0, 200) : 'اختار موضوع مهم من المنهج.'}` }];
    else if (action === 'roleplay') msgs = [{ role: 'system', content: base + '\n\nدلوقتي هنعمل محاكاة: ' + SCEN[role] + '\nانت بتمثل الطرف التاني بس (مش المدرب). رد في سطر أو اتنين بس كل مرة، ومتديش نصايح خلال المحاكاة. ابدأ انت أول جملة لو مفيش رسايل.' }, ...(hist.length ? hist : [{ role: 'user', content: 'ابدأ المحاكاة' }])];
    else if (action === 'evaluate') msgs = [{ role: 'system', content: base }, { role: 'user', content: `دي محادثة تدريب (محاكاة) بين الموظف (user) والطرف التاني (assistant):
${hist.map((m: any) => (m.role === 'user' ? 'الموظف: ' : 'الطرف التاني: ') + m.content).join('\n')}

قيّم أداء الموظف مقارنة بمنهج أفضل موظف:
## الدرجة من 10
## اللي عمله صح
## اللي محتاج يتحسن (مع الجملة الأحسن اللي كان يقولها)
## نصيحة واحدة يركز عليها المرة الجاية` }];
    else msgs = [{ role: 'system', content: base + '\nجاوب على سؤال الموظف عن الشغل بناء على المنهج.' }, ...hist];
    const body: any = { model, messages: msgs };
    if (prov === 'openai') body.max_completion_tokens = action === 'roleplay' ? 400 : 2500; else { body.max_tokens = action === 'roleplay' ? 400 : 2500; body.reasoning_effort = 'low'; }
    let txt = '', last = '';
    for (let i = 0; i < 3 && !txt; i++) {
      const r = await fetch(ep, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j0 = await r.json().catch(() => ({})); const j = Array.isArray(j0) ? j0[0] : j0;
      if (!r.ok) { last = String(j?.error?.message || r.status); if (/demand|overload|unavailable|503|429/i.test(last)) { await new Promise((z) => setTimeout(z, 1500 * (i + 1))); continue; } break; }
      txt = j.choices?.[0]?.message?.content || '';
      admin.from('ai_usage').insert({ tenant_id: me.tenant_id, user_id: me.id, model: prov + ':' + model + ':train', prompt_tokens: j.usage?.prompt_tokens || 0, completion_tokens: j.usage?.completion_tokens || 0 }).then(() => {}, () => {});
    }
    if (!txt) return out(200, { error: /demand|overload|503|429/i.test(last) ? 'خدمة الذكاء الاصطناعي عليها ضغط دلوقتي، جرّب بعد دقيقة' : 'الذكاء الاصطناعي ما ردش: ' + last });
    return out(200, { reply: txt, best: pb.best_name || null });
  } catch (e) { return out(500, { error: String((e as Error).message || e) }); }
});
