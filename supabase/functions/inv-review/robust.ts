// الأنوار — قرار الاستعلام "المقاوم للخطأ" (Robust OR):
// الذكاء الاصطناعي بيقدّر احتمال إن كل بيان حقيقي، والنظام بيعمل آلاف السيناريوهات (مونت كارلو)
// ويختار القرار اللي أسوأ نتايجه (أسوأ 10% من السيناريوهات = CVaR) هي الأحسن، يعني أقل قرار ممكن يطلع غلط.
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const r2 = (x: number) => Math.round(x * 100) / 100;
function rng(seed = 99) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function gauss(R: () => number) { const u = Math.max(1e-9, R()), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

export const CLAIMS: Record<string, string> = { income: 'الدخل المكتوب', job: 'الوظيفة/النشاط', employer: 'جهة العمل', residence: 'السكن والعنوان', housing: 'نوع السكن', obligations: 'الالتزامات المذكورة كاملة', guarantor: 'الضامن وقرابته' };
export type Claim = { key: string; p: number; u: number; why?: string };
export type RobustIn = { income: number; obligations: number; inst: number; points: number; claims: Claim[]; incEst?: { min?: number; avg?: number; max?: number } | null; months?: number; margin?: number };

export function robustDecide(x: RobustIn, N = 3000) {
  const R = rng(123), months = x.months || 12, margin = x.margin ?? 0.23;
  const inc = Math.max(1, x.income), cap = clamp(0.42 - x.points / 500, 0.2, 0.4);
  const safe = Math.max(0, Math.floor((inc * cap - x.obligations) / 50) * 50);
  const opts = [
    { key: 'approve', label: 'قبول بالقسط المطلوب', inst: x.inst, g: false, s: false, acc: 1 },
    { key: 'safe', label: 'قبول بأقصى قسط آمن', inst: Math.min(x.inst, safe), g: false, s: false, acc: 0.95 },
    { key: 'cond', label: 'قبول بشروط: مقدم أكبر (قسط أقل 20%) + ضامن إضافي', inst: x.inst * 0.8, g: true, s: false, acc: 0.85 },
    { key: 'strict', label: 'قبول بشروط مشددة: قسط آمن أقل 20% + ضامن + خطاب مرتب', inst: Math.min(x.inst, safe) * 0.8, g: true, s: true, acc: 0.7 },
    { key: 'reject', label: 'رفض', inst: 0, g: false, s: false, acc: 1 },
  ].filter((o, i, a) => o.key === 'reject' || (o.inst > 0 && !a.slice(0, i).some((p) => p.key !== 'reject' && Math.abs(p.inst - o.inst) < 1 && p.g === o.g && p.s === o.s)));
  const C: Record<string, Claim> = {}; x.claims.forEach((c) => C[c.key] = c);
  const V = opts.map(() => [] as number[]), PD = opts.map(() => [] as number[]);
  const lo = Math.min(inc, x.incEst?.min || inc * 0.5), hi = Math.max(lo, Math.min(inc, x.incEst?.avg || inc * 0.7));
  for (let t = 0; t < N; t++) {
    const tru = (k: string) => { const c = C[k]; if (!c) return true; const p = clamp(c.p + gauss(R) * (c.u * 0.5 + 0.05), 0.01, 0.99); return R() < p; };
    let incS = inc * (0.95 + R() * 0.1), oblS = x.obligations, pts = x.points;
    if (!tru('income')) incS = lo + R() * (hi - lo);
    if (!tru('job')) pts += 12;
    if (!tru('employer')) pts += 10;
    if (!tru('residence')) pts += 20;
    if (!tru('housing')) pts += 5;
    if (!tru('obligations')) oblS += inc * (0.05 + R() * 0.15);
    const gOk = tru('guarantor'); if (!gOk) pts += 8;
    opts.forEach((o, j) => {
      if (o.key === 'reject') { V[j].push(0); PD[j].push(0); return; }
      const dti = (oblS + o.inst) / Math.max(1, incS);
      const z = -3.2 + 0.045 * pts + 4 * Math.max(0, dti - 0.3) - (o.g && gOk ? 0.5 : o.g ? 0.2 : 0) - (o.s ? 0.4 : 0);
      const pd = 1 / (1 + Math.exp(-z)), E = o.inst * months, lgd = o.g ? 0.35 : 0.5;
      // acc = احتمال إن العميل يقبل الشروط (لو رفضها البيعة بتضيع بس من غير خسارة)
      V[j].push(o.acc * ((1 - pd) * E * margin - pd * lgd * E * 0.6)); PD[j].push(pd);
    });
  }
  const best = new Array(opts.length).fill(0);
  for (let t = 0; t < N; t++) { let b = 0; for (let j = 1; j < opts.length; j++) if (V[j][t] > V[b][t]) b = j; best[b]++; }
  const rows = opts.map((o, j) => {
    const v = V[j].slice().sort((a, b) => a - b), k = Math.max(1, Math.floor(N * 0.1));
    const cvar = v.slice(0, k).reduce((s, y) => s + y, 0) / k, mean = v.reduce((s, y) => s + y, 0) / N;
    const pd = PD[j].slice().sort((a, b) => a - b);
    return { key: o.key, label: o.label, accept: o.acc, inst: Math.round(o.inst), guarantor: o.g, salary: o.s, mean: Math.round(mean), cvar: Math.round(cvar), pd_mean: r2(pd.reduce((s, y) => s + y, 0) / N), pd_p90: r2(pd[Math.floor(N * 0.9)] || 0), loss_prob: r2(V[j].filter((y) => y < 0).length / N), best_share: r2(best[j] / N) };
  });
  // القرار: الأعلى في أسوأ 10% من السيناريوهات (مقاوم للخطأ)، ولو اتساووا الأعلى في المتوسط
  // لو في اختيارات قريبة جدًا من الأحسن في الحماية (فرق أقل من 5%) ناخد منهم الأعلى ربحًا متوقعًا
  const byC = rows.slice().sort((a, b) => b.cvar - a.cvar || b.mean - a.mean), top = byC[0], tol = Math.abs(top.cvar) * 0.05;
  const chosen = byC.filter((r) => r.cvar >= top.cvar - tol).sort((a, b) => b.mean - a.mean)[0];
  const ranked = [chosen, ...byC.filter((r) => r !== chosen)];
  return { decisions: ranked, chosen, safe_installment: safe, dti_cap: Math.round(cap * 100), scenarios: N, assumptions: { months, margin } };
}
