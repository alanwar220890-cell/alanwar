// الأنوار — محرك القرار: حسابات بحوث العمليات (Operations Research)
// كل الحسابات هنا ثابتة وقابلة للمراجعة: نفس المدخلات = نفس النتيجة.

export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const r2 = (x: number) => Math.round(x * 100) / 100;
const r0 = (x: number) => Math.round(x);

// مولّد أرقام عشوائية ثابت البذرة علشان النتايج تتكرر
export function rng(seed = 42) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function gauss(R: () => number) { const u = Math.max(1e-9, R()), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
export function normCdf(z: number) { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
export function normPdf(z: number) { return 0.3989422804 * Math.exp(-z * z / 2); }

// ================= 1) هيكلة البيعة =================
export function instCalc(f: number, m: number, r: number, method: string) {
  if (f <= 0 || m < 1) return null;
  if (method === 'flat') { const t = f * (1 + r / 100 * m / 12); return { inst: t / m, total: t }; }
  const q = r / 1200, i = q > 0 ? f * q / (1 - Math.pow(1 + q, -m)) : f / m; return { inst: i, total: i * m };
}
export type DealCtx = { price: number; rate: number; method: string; income: number; obligations: number; points: number; pdMax?: number; maxMonths?: number; minDownPct?: number; maxInst?: number | null; coef?: number[] };
export type DealOpt = { downPct: number; months: number; rate: number; guarantor: boolean; salary: boolean; src?: string };
// معاملات النموذج (تقديرات أولية بتتظبط على بيانات الشركة مع الوقت)
export const DEAL_COEF = [-3.2, 0.045, 4.0, 0.03, 1.5, 0.5, 0.4];
export function dealEval(o: DealOpt, c: DealCtx) {
  const k = c.coef || DEAL_COEF;
  const down = c.price * o.downPct / 100, fin = c.price - down, ic = instCalc(fin, o.months, o.rate, c.method);
  if (!ic) return null;
  const dti = c.income > 0 ? (c.obligations + ic.inst) / c.income : 9;
  const z = k[0] + k[1] * c.points + k[2] * Math.max(0, dti - 0.30) + k[3] * (o.months - 12) - k[4] * (o.downPct / 100) - (o.guarantor ? k[5] : 0) - (o.salary ? k[6] : 0);
  const pd = 1 / (1 + Math.exp(-z));
  const lgd = o.guarantor ? 0.35 : 0.5, interest = ic.total - fin, loss = pd * lgd * fin * 0.6;
  const acc = clamp(1 - 1.4 * Math.max(0, o.downPct / 100 - 0.15) - (o.guarantor ? 0.08 : 0) - (o.salary ? 0.05 : 0) - 0.8 * Math.max(0, ic.inst / Math.max(1, c.income) - 0.25) + 0.5 * (c.rate > 0 ? (c.rate - o.rate) / c.rate : 0), 0.2, 1);
  const cap = clamp(0.42 - c.points / 500, 0.2, 0.4);
  const why: string[] = [];
  if (dti > cap) why.push(`نسبة الالتزام ${Math.round(dti * 100)}% أعلى من الحد الآمن ${Math.round(cap * 100)}%`);
  if (pd > (c.pdMax ?? 0.25)) why.push(`احتمال التعثر ${Math.round(pd * 100)}% أعلى من المسموح ${Math.round((c.pdMax ?? 0.25) * 100)}%`);
  if (c.maxInst && ic.inst > c.maxInst) why.push(`القسط أعلى من أقصى قسط آمن ${c.maxInst}`);
  if (o.downPct < (c.minDownPct ?? 0)) why.push('المقدم أقل من الحد الأدنى');
  const ev = acc * (interest * (1 - pd) - loss);
  return { ...o, down: r0(down), financed: r0(fin), inst: r2(ic.inst), total: r0(ic.total + down), interest: r0(interest), dti: r2(dti), cap: r2(cap), pd: r2(pd), acc: r2(acc), expLoss: r0(loss), ev: r0(ev), ok: why.length === 0, why };
}
export function dealSolve(c: DealCtx, extra: DealOpt[] = []) {
  const months = [6, 9, 12, 15, 18, 24, 30, 36].filter((m) => m <= (c.maxMonths ?? 36));
  const rates = [...new Set([c.rate, r2(c.rate * 0.9), r2(c.rate * 0.8)])];
  const opts: DealOpt[] = [];
  for (let d = 0; d <= 50; d += 5) for (const m of months) for (const r of rates) for (const g of [false, true]) for (const s of [false, true]) opts.push({ downPct: d, months: m, rate: r, guarantor: g, salary: s, src: 'grid' });
  for (const x of extra) opts.push({ ...x, src: 'ai' });
  const all = opts.map((o) => dealEval(o, c)).filter(Boolean) as any[];
  const feas = all.filter((x) => x.ok).sort((a, b) => b.ev - a.ev);
  // 3 بدائل مختلفة فعلًا: الأعلى ربحًا متوقعًا، والأقصر مدة بأعلى ربح، والأقل خطر من غير ما الربح يقل كتير
  const pick: any[] = [];
  if (feas.length) {
    const b1 = feas[0]; pick.push({ ...b1, label: 'أعلى ربح متوقع' });
    const b2 = feas.find((x) => x.months <= Math.min(18, b1.months - 6) && x.ev > 0);
    if (b2) pick.push({ ...b2, label: 'أسرع استرداد (مدة أقصر)' });
    const b3 = feas.filter((x) => x.ev >= b1.ev * 0.7 && !pick.some((p) => p.months === x.months && p.downPct === x.downPct && p.guarantor === x.guarantor && p.salary === x.salary)).sort((a, b) => a.pd - b.pd || b.ev - a.ev)[0];
    if (b3) pick.push({ ...b3, label: 'أقل خطر تعثر' });
    for (const x of feas) { if (pick.length >= 3) break; if (!pick.some((p) => p.months === x.months && Math.abs(p.downPct - x.downPct) < 10)) pick.push({ ...x, label: 'بديل' }); }
  }
  // اختبار الثبات: نغيّر معاملات النموذج ±20% ونشوف الاختيار الأول بيفضل الأول كام مرة
  let stable = 0; const R = rng(7), N = 200, top = feas.slice(0, 40);
  if (pick.length) for (let t = 0; t < N; t++) {
    const coef = DEAL_COEF.map((v) => v * (1 + (R() - 0.5) * 0.4));
    let best: any = null; for (const x of top) { const e = dealEval(x, { ...c, coef }); if (e && e.ok && (!best || e.ev > best.ev)) best = e; }
    if (best && best.months === pick[0].months && Math.abs(best.downPct - pick[0].downPct) < 10 && best.guarantor === pick[0].guarantor) stable++;
  }
  const near = feas.length ? null : all.slice().sort((a, b) => a.why.length - b.why.length || a.pd - b.pd)[0];
  return { evaluated: all.length, feasible: feas.length, top: pick, robustness: pick.length ? Math.round(stable / N * 100) : null, nearest: near };
}

// ================= 2) خطة التحصيل (Min-Cost Flow = حل أمثل مضبوط) =================
type E = { to: number; cap: number; cost: number; rev: number; tag?: any };
export function mcmf(n: number) {
  const g: E[][] = Array.from({ length: n }, () => []);
  return {
    g,
    add(u: number, v: number, cap: number, cost: number, tag?: any) { g[u].push({ to: v, cap, cost, rev: g[v].length, tag }); g[v].push({ to: u, cap: 0, cost: -cost, rev: g[u].length - 1 }); },
    // أقل تكلفة (= أعلى قيمة) — بيقف أول ما مفيش مسار بيحسّن
    run(s: number, t: number) {
      let flow = 0, cost = 0;
      for (let it = 0; it < 100000; it++) {
        const dist = new Array(n).fill(Infinity), inq = new Array(n).fill(false), pv = new Array(n).fill(-1), pe = new Array(n).fill(-1);
        dist[s] = 0; const q = [s]; inq[s] = true; let h = 0;
        while (h < q.length) { const u = q[h++]; inq[u] = false; for (let i = 0; i < g[u].length; i++) { const e = g[u][i]; if (e.cap > 0 && dist[u] + e.cost < dist[e.to]) { dist[e.to] = dist[u] + e.cost; pv[e.to] = u; pe[e.to] = i; if (!inq[e.to]) { inq[e.to] = true; q.push(e.to); } } } }
        if (dist[t] === Infinity || dist[t] >= 0) break;
        let f = Infinity; for (let v = t; v !== s; v = pv[v]) f = Math.min(f, g[pv[v]][pe[v]].cap);
        for (let v = t; v !== s; v = pv[v]) { const e = g[pv[v]][pe[v]]; e.cap -= f; g[v][e.rev].cap += f; }
        flow += f; cost += f * dist[t];
      }
      return { flow, cost };
    },
  };
}
export const ACT: Record<string, { name: string; res: 'call' | 'wa' | 'visit'; mult: number; amt: number; minDays: number }> = {
  wa: { name: 'رسالة واتساب', res: 'wa', mult: 0.6, amt: 1, minDays: 1 },
  call: { name: 'مكالمة', res: 'call', mult: 1, amt: 1, minDays: 1 },
  settle: { name: 'عرض تسوية (خصم 10% من المتأخر)', res: 'call', mult: 1.6, amt: 0.9, minDays: 31 },
  legalw: { name: 'مكالمة إنذار قبل الشؤون', res: 'call', mult: 1.3, amt: 1, minDays: 61 },
  visit: { name: 'زيارة ميدانية', res: 'visit', mult: 1.5, amt: 1, minDays: 15 },
};
export function bucketOf(d: number) { return d <= 30 ? 'b1' : d <= 60 ? 'b2' : d <= 90 ? 'b3' : 'b4'; }
// معدل السداد خلال 30 يوم حسب شريحة التأخير: تقدير مبدئي + بيانات الشركة (Bayes)
export function calibrate(h: any) {
  const prior: Record<string, number> = { b1: 0.55, b2: 0.38, b3: 0.25, b4: 0.12 }, out: Record<string, number> = {}, used: Record<string, number> = {};
  const ks = ['b1', 'b2', 'b3', 'b4'];
  ks.forEach((k, i) => {
    const num = +(h?.[k] || 0), den = ks.slice(i).reduce((s, x) => s + +(h?.[x] || 0), 0) + +(h?.never || 0);
    out[k] = r2((num + prior[k] * 20) / (den + 20)); used[k] = den;
  });
  return { rate: out, n: used };
}
export type Debt = { id: string; branch_id: string; days: number; amount: number; risk: number; name?: string; phone?: string; zone?: string };
export type Coll = { id: string; name: string; branch_id: string | null };
export function actionValue(d: Debt, a: string, rate: Record<string, number>, w = 1) {
  const A = ACT[a]; if (d.days < A.minDays) return null;
  const base = rate[bucketOf(d.days)] ?? 0.3, rf = clamp(1 - d.risk / 150, 0.3, 1);
  const p = clamp(base * A.mult * rf, 0, 0.95), exp = d.amount * A.amt * p, self = d.amount * base * rf * 0.3;
  return { p: r2(p), exp: r0(exp), gain: Math.max(0, exp - self) * w };
}
export function collectSolve(debts: Debt[], cols: Coll[], cap: { call: number; wa: number; visit: number }, rate: Record<string, number>, variant: 'max' | 'balanced' | 'legal') {
  const K = cols.length, N = debts.length, RES = ['call', 'wa', 'visit'] as const;
  if (!K || !N) return { expected: 0, assigned: 0, per: [], variant };
  const S = 0, T = 1, D0 = 2, R0 = 2 + N, C0 = R0 + K * 3, net = mcmf(2 + N + K * 4);
  const totalCap = cols.length * (cap.call + cap.wa + cap.visit), fair = Math.ceil(Math.min(N, totalCap) / K);
  cols.forEach((c, j) => {
    RES.forEach((r, ri) => net.add(R0 + j * 3 + ri, C0 + j, cap[r], 0));
    net.add(C0 + j, T, variant === 'balanced' ? fair : N, 0); // التوازن: مفيش محصل ياخد أكتر من نصيبه العادل
  });
  debts.forEach((d, i) => {
    net.add(S, D0 + i, 1, 0);
    const w = variant === 'legal' && d.days > 45 && d.days <= 120 ? 1.4 : 1;
    cols.forEach((c, j) => {
      if (c.branch_id && c.branch_id !== d.branch_id) return;
      RES.forEach((r, ri) => {
        let best: any = null;
        for (const a of Object.keys(ACT)) if (ACT[a].res === r) { const v = actionValue(d, a, rate, w); if (v && (!best || v.gain > best.gain)) best = { a, ...v }; }
        if (best && best.gain > 0.5) net.add(D0 + i, R0 + j * 3 + ri, 1, -Math.round(best.gain * 100), { i, j, ...best });
      });
    });
  });
  net.run(S, T);
  const per = cols.map((c) => ({ id: c.id, name: c.name, calls: 0, wa: 0, visits: 0, expected: 0, items: [] as any[] }));
  let expected = 0, assigned = 0;
  debts.forEach((d, i) => {
    for (const e of net.g[D0 + i]) if (e.tag && e.cap === 0) {
      const t = e.tag, P = per[t.j]; assigned++; expected += t.exp;
      P.expected += t.exp; if (ACT[t.a].res === 'call') P.calls++; else if (ACT[t.a].res === 'wa') P.wa++; else P.visits++;
      P.items.push({ id: d.id, name: d.name, phone: d.phone, zone: d.zone, days: d.days, amount: d.amount, action: t.a, action_name: ACT[t.a].name, p: t.p, exp: t.exp });
    }
  });
  per.forEach((P) => P.items.sort((a, b) => b.exp - a.exp));
  const loads = per.map((p) => p.items.length), atRisk = debts.filter((d) => d.days > 45 && d.days <= 120).length;
  const atRiskCovered = per.reduce((s, p) => s + p.items.filter((x: any) => x.days > 45 && x.days <= 120).length, 0);
  return { variant, expected: r0(expected), assigned, total: N, overdue: r0(debts.reduce((s, d) => s + d.amount, 0)), spread: loads.length ? Math.max(...loads) - Math.min(...loads) : 0, at_risk: atRisk, at_risk_covered: atRiskCovered, per: per.filter((p) => p.items.length) };
}

// ================= 3) توزيع التارجت (Water-filling + احتمال التحقيق) =================
export type Unit = { id: string; name: string; series: number[] }; // من الأقدم للأحدث (شهري)
export function unitStats(u: Unit) {
  const s = u.series, L = s.length, last3 = s.slice(-3), prev3 = s.slice(-6, -3);
  const wavg = last3.length ? (last3[last3.length - 1] * 0.5 + (last3[last3.length - 2] ?? last3[last3.length - 1]) * 0.3 + (last3[0] ?? 0) * 0.2) : 0;
  const a3 = last3.reduce((x, y) => x + y, 0) / Math.max(1, last3.length), p3 = prev3.reduce((x, y) => x + y, 0) / Math.max(1, prev3.length);
  const trend = p3 > 0 ? clamp((a3 - p3) / p3, -0.3, 0.5) : 0;
  const s6 = s.slice(-6), m6 = s6.reduce((x, y) => x + y, 0) / Math.max(1, s6.length);
  const sd = Math.sqrt(s6.reduce((x, y) => x + (y - m6) ** 2, 0) / Math.max(1, s6.length - 1));
  const mu = Math.max(0, wavg * (1 + trend / 2));
  return { mu, sd: Math.max(sd, mu * 0.25, 1), trend, avg: a3, months: L };
}
function fill(T: number, f: (x: number) => number[], hiX: number) { let lo = 0, hi = hiX; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2, s = f(m).reduce((a, b) => a + b, 0); if (s < T) lo = m; else hi = m; } return f(hi); }
export function expMin(mu: number, sd: number, t: number) { const z = (mu - t) / sd; return mu - (sd * normPdf(z) + (mu - t) * normCdf(z)); }
export function targetsSolve(units: Unit[], T: number, minG = 0.8, maxG = 1.6) {
  const st = units.map(unitStats), n = units.length;
  const lo = st.map((s) => s.mu > 0 ? s.mu * minG : 0), hi = st.map((s) => s.mu > 0 ? s.mu * maxG : T / n);
  const maxT = hi.reduce((a, b) => a + b, 0), minT = lo.reduce((a, b) => a + b, 0);
  const feasible = T <= maxT && T >= minT;
  const Tt = clamp(T, minT, maxT);
  const mk = (name: string, why: string, alloc: number[]) => {
    const rows = units.map((u, i) => { const t = r0(alloc[i]); return { id: u.id, name: u.name, target: t, forecast: r0(st[i].mu), last3: r0(st[i].avg), trend: Math.round(st[i].trend * 100), prob: Math.round(normCdf((st[i].mu - t) / st[i].sd) * 100), stretch: st[i].mu > 0 ? Math.round(t / st[i].mu * 100) : null }; });
    const ach = units.reduce((s, _, i) => s + expMin(st[i].mu, st[i].sd, alloc[i]), 0) / Math.max(1, Tt);
    return { name, why, rows, expected_pct: Math.round(ach * 100), min_prob: Math.min(...rows.map((r) => r.prob)), avg_prob: Math.round(rows.reduce((s, r) => s + r.prob, 0) / n) };
  };
  const cl = (i: number, x: number) => clamp(x, lo[i], hi[i]);
  const S1 = fill(Tt, (k) => st.map((s, i) => cl(i, k * Math.max(s.mu, 1))), 50);
  const S2 = fill(Tt, (k) => st.map((s, i) => cl(i, k * Math.max(s.mu, 1) * (1 + Math.max(0, s.trend)))), 50);
  const S3 = fill(Tt, (k) => st.map((s, i) => cl(i, s.mu + k)), Tt + 1);
  const res = [
    mk('بنسبة القدرة المتوقعة', 'كل وحدة بتتطلب منها نفس النسبة من قدرتها المتوقعة — أعدل توزيع لتقليل احتمال الفشل', S1),
    mk('حسب فرص النمو', 'اللي بينمو أكتر بياخد حمل أكبر — بيستغل الزخم', S2),
    mk('زيادة متساوية', 'كل وحدة بتزيد نفس المبلغ عن متوقعها — بسيط وسهل الشرح', S3),
  ].sort((a, b) => b.expected_pct - a.expected_pct || b.min_prob - a.min_prob);
  return { feasible, requested: T, used: r0(Tt), min_possible: r0(minT), max_possible: r0(maxT), schemes: res };
}

// ================= 4) أي سؤال: TOPSIS + محاكاة مونت كارلو للثبات =================
export type Crit = { key: string; name: string; weight: number; dir: 'benefit' | 'cost' };
export function topsis(M: number[][], w: number[], dir: string[]) {
  const n = M.length, m = w.length, ws = w.reduce((a, b) => a + b, 0) || 1, W = w.map((x) => x / ws);
  const norm = Array.from({ length: m }, (_, j) => Math.sqrt(M.reduce((s, r) => s + r[j] * r[j], 0)) || 1);
  const V = M.map((r) => r.map((x, j) => x / norm[j] * W[j]));
  const best = Array.from({ length: m }, (_, j) => dir[j] === 'cost' ? Math.min(...V.map((r) => r[j])) : Math.max(...V.map((r) => r[j])));
  const worst = Array.from({ length: m }, (_, j) => dir[j] === 'cost' ? Math.max(...V.map((r) => r[j])) : Math.min(...V.map((r) => r[j])));
  return V.map((r) => { const dp = Math.sqrt(r.reduce((s, x, j) => s + (x - best[j]) ** 2, 0)), dn = Math.sqrt(r.reduce((s, x, j) => s + (x - worst[j]) ** 2, 0)); return dp + dn ? dn / (dp + dn) : 0; });
}
export function mcdaSolve(alts: any[], crit: Crit[], S1: number[][], S2: number[][] | null, runs = 3000) {
  const n = alts.length, m = crit.length;
  const M = S1.map((r, i) => r.map((x, j) => S2 ? (x + S2[i][j]) / 2 : x));
  const U = S1.map((r, i) => r.map((x, j) => S2 ? Math.max(0.5, Math.abs(x - S2[i][j])) : 1));
  const w = crit.map((c) => c.weight), dir = crit.map((c) => c.dir);
  const base = topsis(M, w, dir);
  const top1 = new Array(n).fill(0), top3 = new Array(n).fill(0), R = rng(11);
  for (let t = 0; t < runs; t++) {
    const wt = w.map((x) => x * (0.7 + R() * 0.6));
    const Mt = M.map((r, i) => r.map((x, j) => clamp(x + gauss(R) * U[i][j] * 0.6, 0.5, 10)));
    const sc = topsis(Mt, wt, dir), ord = sc.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
    top1[ord[0][1]]++; for (let k = 0; k < Math.min(3, n); k++) top3[ord[k][1]]++;
  }
  const agree = S2 ? Math.round(100 - 100 * S1.flat().reduce((s, x, k) => s + Math.abs(x - S2.flat()[k]), 0) / (n * m * 9)) : null;
  const ranked = alts.map((a, i) => ({ ...a, score: Math.round(base[i] * 100), win: Math.round(top1[i] / runs * 100), top3: Math.round(top3[i] / runs * 100), cells: crit.map((c, j) => ({ k: c.key, v: r2(M[i][j]), u: r2(U[i][j]) })) })).sort((a, b) => b.score - a.score);
  return { ranked, agree, runs };
}
