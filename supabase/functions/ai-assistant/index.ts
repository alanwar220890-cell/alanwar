// الأنوار — المساعد الذكي (OpenAI أو Google Gemini)
// - المفاتيح OPENAI_API_KEY / GEMINI_API_KEY بتتحط في Supabase Secrets بس، عمرها ما بتوصل للمتصفح.
// - كل قراءة للبيانات بتتعمل بصلاحيات الموظف نفسه (RLS).
// - أي تنفيذ بيرجع كـ«اقتراح» والموظف يأكده من البرنامج.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const out = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const RL: Record<string, string> = { system_admin: 'المدير العام', credit_manager: 'مسؤول الائتمان', branch_manager: 'مدير فرع', sales: 'موظف مبيعات', collector: 'محصل', field_agent: 'موظف استعلام ميداني', lawyer: 'محامي', collection_rep: 'مندوب تحصيل' };
const maskPhone = (p?: string) => (p ? String(p).replace(/\d(?=\d{3})/g, '•') : null);
const cairoToday = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
function period(p?: string) {
  const t = cairoToday(), y = +t.slice(0, 4), m = +t.slice(5, 7);
  if (p === 'last_month') { const d = new Date(Date.UTC(y, m - 2, 1)); const e = new Date(Date.UTC(y, m - 1, 0)); return [d.toISOString().slice(0, 10), e.toISOString().slice(0, 10)]; }
  if (p === 'this_year') return [`${y}-01-01`, t];
  return [`${t.slice(0, 7)}-01`, t];
}

type Tool = { perms: string[] | null; spec: any; run: (a: any, ctx: any) => Promise<unknown> };
const T: Record<string, Tool> = {
  my_performance: { perms: null, spec: { description: 'مؤشرات أداء الموظف الحالي (مبيعات، تحصيل، متابعات، مهام، حضور)', parameters: { type: 'object', properties: { period: { type: 'string', enum: ['this_month', 'last_month', 'this_year'] } } } },
    run: async (a, c) => { const [f, t] = period(a.period); const r = await c.db.rpc('perf_employees', { p_from: f, p_to: t }); return (r.data || []).filter((x: any) => x.id === c.me.id); } },
  team_performance: { perms: ['ai.view', 'hr.view'], spec: { description: 'مؤشرات أداء كل الموظفين المسموح للمستخدم يشوفهم', parameters: { type: 'object', properties: { period: { type: 'string', enum: ['this_month', 'last_month', 'this_year'] }, role: { type: 'string' } } } },
    run: async (a, c) => { const [f, t] = period(a.period); const r = await c.db.rpc('perf_employees', { p_from: f, p_to: t }); return (r.data || []).filter((x: any) => !a.role || x.role === a.role); } },
  branch_performance: { perms: ['ai.view', 'fin.view', 'hr.view'], spec: { description: 'مؤشرات الفروع: مبيعات، تحصيل، متأخرات بالشرائح، قانوني، استعلامات وموافقات، تجديد', parameters: { type: 'object', properties: { period: { type: 'string', enum: ['this_month', 'last_month', 'this_year'] } } } },
    run: async (a, c) => { const [f, t] = period(a.period); return (await c.db.rpc('perf_branches', { p_from: f, p_to: t })).data; } },
  kpi_trend: { perms: ['ai.view'], spec: { description: 'لقطات يومية لمؤشرات الفروع آخر 30 يوم لمعرفة الاتجاه', parameters: { type: 'object', properties: {} } },
    run: async (_a, c) => (await c.db.from('kpi_daily').select('day,data').eq('kind', 'branches').order('day', { ascending: false }).limit(30)).data },
  list_staff: { perms: ['task.assign', 'ai.view'], spec: { description: 'قائمة الموظفين (id والاسم والوظيفة والفرع) لاستخدامها في إسناد المهام', parameters: { type: 'object', properties: {} } },
    run: async (_a, c) => (await c.db.from('profiles').select('id,full_name,role,branch_id').eq('active', true)).data },
  search_customers: { perms: ['cust.view', 'coll.view', 'con.view', 'legal.view'], spec: { description: 'بحث عن عميل بالاسم أو الكود', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    run: async (a, c) => { const q = String(a.query || '').replace(/[%,()]/g, ' ').trim(); const r = await c.db.from('customers').select('id,full_name,customer_code,phone,branch_id').or(`full_name.ilike.%${q}%,customer_code.ilike.%${q}%`).limit(10); return (r.data || []).map((x: any) => ({ ...x, phone: maskPhone(x.phone) })); } },
  customer_details: { perms: ['cust.view', 'coll.view', 'con.view', 'legal.view'], spec: { description: 'تفاصيل عميل: عقوده وحالتها والمتأخر عليه ودرجة الخطر وأسبابها', parameters: { type: 'object', properties: { customer_id: { type: 'string' } }, required: ['customer_id'] } },
    run: async (a, c) => {
      const [cu, k, d, s] = await Promise.all([c.db.from('customers').select('full_name,customer_code,housing,branch_id').eq('id', a.customer_id).single(),
        c.db.from('contracts').select('code,status,product_name,price,months,installment,start_date,closed_at').eq('customer_id', a.customer_id),
        c.db.from('v_delinquency').select('days_late,overdue_amount,category').eq('customer_id', a.customer_id),
        c.db.from('cust_scores').select('risk,renew,late_ratio,deferrals,reasons').eq('customer_id', a.customer_id).maybeSingle()]);
      return { customer: cu.data, contracts: k.data, delinquency: d.data, score: s.data };
    } },
  late_customers: { perms: ['coll.view'], spec: { description: 'العملاء المتأخرين مرتبين بالمبلغ مع درجة الخطر', parameters: { type: 'object', properties: { min_days: { type: 'number' }, limit: { type: 'number' } } } },
    run: async (a, c) => {
      const r = await c.db.from('v_delinquency').select('contract_id,customer_id,branch_id,days_late,overdue_amount,category').gt('days_late', a.min_days || 0).order('overdue_amount', { ascending: false }).limit(Math.min(+a.limit || 25, 50));
      const ids = (r.data || []).map((x: any) => x.customer_id);
      const [n, s] = await Promise.all([c.db.from('customers').select('id,full_name,assigned_to').in('id', ids), c.db.from('cust_scores').select('customer_id,risk,reasons').in('customer_id', ids)]);
      const N = Object.fromEntries((n.data || []).map((x: any) => [x.id, x])), Sx = Object.fromEntries((s.data || []).map((x: any) => [x.customer_id, x]));
      return (r.data || []).map((x: any) => ({ ...x, name: N[x.customer_id]?.full_name, assigned_to: N[x.customer_id]?.assigned_to, risk: Sx[x.customer_id]?.risk, reasons: Sx[x.customer_id]?.reasons }));
    } },
  my_followups: { perms: ['camp.follow', 'camp.manage'], spec: { description: 'العملاء المنتهين اللي محتاجين متابعة وتجديد', parameters: { type: 'object', properties: { status: { type: 'string', enum: ['new', 'contacted', 'interested', 'renewed', 'not_interested'] } } } },
    run: async (a, c) => { let q = c.db.from('renew_followups').select('id,customer_id,status,notes,last_contact_at,contact_count,next_followup,assigned_to,customers(full_name)').limit(40); if (a.status) q = q.eq('status', a.status); return (await q).data; } },
  my_leads: { perms: ['leads.view', 'leads.edit'], spec: { description: 'العملاء المحتملين (المبيعات) وحالتهم ومواعيد متابعتهم', parameters: { type: 'object', properties: { status: { type: 'string', enum: ['new', 'follow_up', 'qualified', 'converted', 'lost'] } } } },
    run: async (a, c) => { let q = c.db.from('leads').select('id,full_name,status,interest,next_followup,visit_date,contact_count,last_contact_at,assigned_to,notes').order('next_followup', { ascending: true }).limit(40); if (a.status) q = q.eq('status', a.status); return (await q).data; } },
  investigations: { perms: ['inv.view', 'inv.visit', 'inv.credit', 'inv.create'], spec: { description: 'الاستعلامات وحالتها وقرارات الائتمان', parameters: { type: 'object', properties: { status: { type: 'string', enum: ['documents', 'visit', 'credit_review', 'approved', 'rejected', 'cancelled'] } } } },
    run: async (a, c) => { let q = c.db.from('investigations').select('id,customer_name,inv_type,status,assigned_agent,due_date,created_at,credit_decision,credit_recommendation,credit_reasons,dti,net_income,obligations_monthly,new_installment,housing,occupation_type').order('created_at', { ascending: false }).limit(30); if (a.status) q = q.eq('status', a.status); return (await q).data; } },
  ops_plans: { perms: null, spec: { description: 'خطط التحسين (OR-Tools) الأخيرة: توزيع التحصيل، زيارات الاستعلام، أولويات التسويق، التارجت المقترح', parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['collection', 'investigation', 'marketing', 'targets'] } } } },
    run: async (a, c) => { let q = c.db.from('ops_plans').select('kind,plan_date,branch_id,user_id,summary,status,data').order('plan_date', { ascending: false }).limit(20); if (a.kind) q = q.eq('kind', a.kind); return (await q).data; } },
  my_tasks: { perms: null, spec: { description: 'مهام الموظف المفتوحة', parameters: { type: 'object', properties: {} } },
    run: async (_a, c) => (await c.db.from('tasks').select('id,title,details,due_date,status').eq('assigned_to', c.me.id).eq('status', 'open').order('due_date').limit(30)).data },
  propose_task: { perms: ['task.view', 'task.assign'], spec: { description: 'اقتراح مهمة جديدة (الموظف لازم يأكد). لو لموظف تاني لازم صلاحية الإسناد', parameters: { type: 'object', properties: { title: { type: 'string' }, details: { type: 'string' }, assignee_id: { type: 'string' }, due_date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['title'] } },
    run: async (a, c) => { if (a.assignee_id && a.assignee_id !== c.me.id && !c.perms.includes('task.assign')) return { error: 'مش مسموح تسند مهام لغيرك' }; c.actions.push({ type: 'task', ...a }); return { proposed: true }; } },
  propose_followup: { perms: ['camp.follow', 'camp.manage'], spec: { description: 'اقتراح تسجيل متابعة لعميل منتهي', parameters: { type: 'object', properties: { followup_id: { type: 'string' }, status: { type: 'string', enum: ['contacted', 'interested', 'renewed', 'not_interested'] }, note: { type: 'string' } }, required: ['followup_id', 'note'] } },
    run: async (a, c) => { c.actions.push({ type: 'followup', ...a }); return { proposed: true }; } },
  propose_lead_update: { perms: ['leads.edit'], spec: { description: 'اقتراح تحديث عميل محتمل (حالة، ملاحظة، ميعاد متابعة)', parameters: { type: 'object', properties: { lead_id: { type: 'string' }, status: { type: 'string', enum: ['new', 'follow_up', 'qualified', 'lost'] }, note: { type: 'string' }, next_followup: { type: 'string' } }, required: ['lead_id'] } },
    run: async (a, c) => { c.actions.push({ type: 'lead', ...a }); return { proposed: true }; } },
  propose_whatsapp: { perms: ['cust.view', 'coll.view', 'camp.follow', 'leads.view'], spec: { description: 'اقتراح رسالة واتساب لعميل (الموظف بيبعتها بنفسه)', parameters: { type: 'object', properties: { customer_id: { type: 'string' }, lead_id: { type: 'string' }, message: { type: 'string' } }, required: ['message'] } },
    run: async (a, c) => { c.actions.push({ type: 'whatsapp', ...a }); return { proposed: true }; } },
};

function sysPrompt(me: any, perms: string[], branch: string, mode: string) {
  const gm = me.role === 'system_admin';
  return `انت «مساعد الأنوار»، المساعد الذكي لشركة الأنوار للبيع بالتقسيط في مصر. اتكلم بالعامية المصرية المهذبة، باختصار وبشكل عملي.
المستخدم: ${me.full_name} — ${RL[me.role] || me.role}${branch ? ' — ' + branch : ''}. النهارده ${cairoToday()}.
${gm ? 'ده المدير العام: عنده كل الصلاحيات وكل الفروع.' : 'ساعده في حدود وظيفته وصلاحياته بس: ' + perms.join(', ') + '. لو طلب حاجة بره صلاحياته قوله بلطف إنها مش متاحة له.'}
قواعد:
- أي رقم أو اسم لازم يكون جاي من الأدوات. متألفش أرقام. لو البيانات مش كفاية قول كده.
- قرارات الائتمان والجزاءات والفصل قرارات بشرية: انت بترشّح وبتشرح الأسباب بس.
- لو هتقترح تنفيذ (مهمة/متابعة/رسالة) استخدم أدوات propose_* — هتظهر للموظف يأكدها، ومتقولش إنها اتنفذت.
- في التحليل: رتب المشاكل بالأثر المالي، واشرح السبب المحتمل، وادي خطة علاج محددة (مين، يعمل إيه، إمتى، وإزاي نقيس التحسن).
- مؤشرات مهمة: نسبة التحصيل = due_paid/due_value، التأخر بالشرائح (late_30/60/90/90p)، تحويل الاستعلامات لمبيعات (approved_not_sold)، العملاء المنتهين اللي متتواصلش معاهم (renew_untouched)، المهام في ميعادها (tasks_ontime/tasks_n).
- خطط التحسين (ops_plans) معمولة بـ Google OR-Tools: استخدمها لما يسأل عن التوزيع أو الأولويات.
${mode === 'report' ? 'المطلوب: تقرير تحليلي شامل للإدارة بالعناوين: 1) الملخص التنفيذي 2) أهم المشاكل مرتبة بالأثر 3) تحليل كل فرع 4) الموظفين اللي محتاجين دعم أو اللي متميزين 5) خطة علاج 30 يوم بأهداف رقمية 6) فرص زيادة الربحية (كاش وتقسيط وتحصيل وتجديد). وبعدها اقترح مهام تنفيذية بـ propose_task لكل نقطة مهمة مع الموظف المسؤول.' : ''}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const auth = req.headers.get('Authorization') || '';
    const db = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: u } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    if (!u?.user) return out(401, { error: 'سجّل دخول الأول' });
    const { data: me } = await db.from('profiles').select('id,tenant_id,full_name,role,branch_id,active').eq('id', u.user.id).single();
    if (!me?.active) return out(403, { error: 'حسابك مش مفعّل' });
    const body = await req.json().catch(() => ({}));
    const mode = body.mode === 'report' ? 'report' : 'chat';
    const okey = Deno.env.get('OPENAI_API_KEY'), gkey = Deno.env.get('GEMINI_API_KEY');
    if (!okey && !gkey) return out(200, { setup: true, reply: 'المساعد الذكي جاهز، بس لسه مفيش ربط بأداة ذكاء اصطناعي. المدير العام يحط مفتاح Gemini (مجاني) أو OpenAI في Supabase علشان يشتغل.' });
    const perms: string[] = (await db.rpc('my_perms')).data || [];
    if (mode === 'report' && !perms.includes('ai.view')) return out(403, { error: 'التقرير التحليلي للإدارة بس' });
    const { data: cfgRow } = await admin.from('app_settings').select('value').eq('tenant_id', me.tenant_id).eq('key', 'ai_config').maybeSingle();
    const cfg0 = cfgRow?.value || {};
    const provider = cfg0.provider === 'openai' && okey ? 'openai' : cfg0.provider === 'gemini' && gkey ? 'gemini' : (okey ? 'openai' : 'gemini');
    const key = provider === 'openai' ? okey! : gkey!;
    const endpoint = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    const cfg = { monthly_token_limit: 3000000, user_daily_messages: 60, ...cfg0, model: (provider === 'openai' ? cfg0.model : cfg0.gemini_model) || (provider === 'openai' ? 'gpt-5.4-mini' : 'gemini-3.8-flash') };
    const m0 = cairoToday().slice(0, 7) + '-01';
    const { data: used } = await admin.from('ai_usage').select('prompt_tokens,completion_tokens,user_id,at').eq('tenant_id', me.tenant_id).gte('at', m0);
    const tot = (used || []).reduce((s: number, x: any) => s + (x.prompt_tokens || 0) + (x.completion_tokens || 0), 0);
    if (tot >= cfg.monthly_token_limit) return out(200, { reply: 'وصلنا للحد الشهري المسموح لاستخدام المساعد. المدير العام يقدر يزوده من إعدادات المساعد.' });
    const mine = (used || []).filter((x: any) => x.user_id === me.id && String(x.at).slice(0, 10) === cairoToday()).length;
    if (mine >= cfg.user_daily_messages && me.role !== 'system_admin') return out(200, { reply: 'خلصت عدد رسايلك للمساعد النهارده. جرب بكرة.' });

    const { data: br } = me.branch_id ? await db.from('branches').select('name').eq('id', me.branch_id).single() : { data: null };
    const allowed = Object.entries(T).filter(([n, t]) => me.role === 'system_admin' || !t.perms || t.perms.some((p) => perms.includes(p)))
      .filter(([n]) => mode === 'chat' || !['propose_followup', 'propose_lead_update', 'propose_whatsapp'].includes(n));
    const tools = allowed.map(([name, t]) => ({ type: 'function', function: { name, ...t.spec } }));
    const ctx = { db, me, perms, actions: [] as any[] };
    const hist = (Array.isArray(body.messages) ? body.messages : []).slice(-12).filter((m: any) => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }));
    if (mode === 'report') hist.push({ role: 'user', content: 'اعمل التقرير التحليلي الأسبوعي دلوقتي. استخدم branch_performance و team_performance للشهر ده والشهر اللي فات و kpi_trend و ops_plans.' });
    const msgs: any[] = [{ role: 'system', content: sysPrompt(me, perms, br?.name || '', mode) }, ...hist];
    let pt = 0, ct = 0, reply = '';
    for (let i = 0; i < 8; i++) {
      const lim = mode === 'report' ? 8000 : 2500;
      const payload: any = { model: cfg.model, messages: msgs, tools };
      if (provider === 'openai') payload.max_completion_tokens = lim; else { payload.max_tokens = lim; payload.reasoning_effort = 'low'; }
      const r = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j0 = await r.json(); const j = Array.isArray(j0) ? j0[0] : j0;
      if (!r.ok) return out(200, { error: (provider === 'openai' ? 'OpenAI: ' : 'Gemini: ') + (j?.error?.message || r.status) });
      pt += j.usage?.prompt_tokens || 0; ct += j.usage?.completion_tokens || 0;
      const msg = j.choices?.[0]?.message; if (!msg) break;
      msgs.push(msg);
      if (!msg.tool_calls?.length) { reply = msg.content || ''; break; }
      for (const tc of msg.tool_calls) {
        const t = allowed.find(([n]) => n === tc.function.name);
        let res: unknown;
        try { res = t ? await t[1].run(JSON.parse(tc.function.arguments || '{}'), ctx) : { error: 'أداة غير متاحة' }; } catch (e) { res = { error: String(e) }; }
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(res).slice(0, 60000) });
      }
    }
    await admin.from('ai_usage').insert({ tenant_id: me.tenant_id, user_id: me.id, model: provider + ':' + cfg.model, prompt_tokens: pt, completion_tokens: ct });
    return out(200, { reply: reply || 'مقدرتش أكمل الطلب ده، جرب تسأل بشكل تاني.', actions: ctx.actions, usage: { prompt: pt, completion: ct }, provider });
  } catch (e) {
    return out(200, { error: String(e) });
  }
});
