"""
الأنوار — محرك التحسين (Google OR-Tools)
بيشتغل كل ليلة على GitHub Actions ويطلع خطط ليوم بكرة:
  1) توزيع العملاء المتأخرين على المحصلين (أكبر تحصيل متوقع بعدد الزيارات المتاح، ونفس المنطقة لنفس المحصل)
  2) توزيع زيارات الاستعلام الميداني على موظفي الاستعلام
  3) أولويات متابعة العملاء المنتهين (التسويق) على موظفي المبيعات
  4) اقتراح تارجت الشهر الجاي لكل فرع وموظف مبيعات من الأداء الفعلي
البيانات بتيجي من Supabase بدالة ops_fetch والنتايج بتتحفظ بدالة ops_save (محمية بتوكن OPS_TOKEN).
"""
import json, os, re, sys, datetime, urllib.request
from collections import defaultdict
from ortools.sat.python import cp_model
from ortools.linear_solver import pywraplp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def cfg():
    s = open(os.path.join(ROOT, 'config.js'), encoding='utf-8').read()
    return re.search(r'url:\s*"([^"]+)"', s).group(1), re.search(r'key:\s*"([^"]+)"', s).group(1)


def rpc(name, body):
    url, key = cfg()
    req = urllib.request.Request(f'{url}/rest/v1/rpc/{name}', data=json.dumps(body).encode(), method='POST',
                                 headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode() or 'null')


def solve_assignment(items, workers, cap, value, zone, keep, lam_zone=0.35, keep_bonus=0.15, time_limit=20):
    """CP-SAT: كل عنصر لعامل واحد بالكتير، سعة لكل عامل، تعظيم القيمة مع تقليل عدد المناطق لكل عامل
    وتفضيل العامل الحالي للعنصر (استمرارية)."""
    if not items or not workers:
        return {}
    m = cp_model.CpModel()
    S = 100  # scale to ints
    x = {}
    for i, it in enumerate(items):
        for w in workers:
            x[i, w] = m.NewBoolVar(f'x{i}_{w[:6]}')
        m.Add(sum(x[i, w] for w in workers) <= 1)
    zones = sorted({zone(it) for it in items})
    y = {(w, z): m.NewBoolVar(f'y{w[:6]}_{zi}') for w in workers for zi, z in enumerate(zones)}
    for i, it in enumerate(items):
        for w in workers:
            m.Add(x[i, w] <= y[w, zone(it)])
    for w in workers:
        m.Add(sum(x[i, w] for i in range(len(items))) <= cap)
    vals = [max(1, value(it)) for it in items]
    avg = sum(vals) / len(vals)
    obj = []
    for i, it in enumerate(items):
        for w in workers:
            v = vals[i] * (1 + (keep_bonus if keep(it) == w else 0))
            obj.append(int(v * S) * x[i, w])
    obj += [-int(avg * lam_zone * S) * y[k] for k in y]
    m.Maximize(sum(obj))
    sv = cp_model.CpSolver()
    sv.parameters.max_time_in_seconds = time_limit
    sv.parameters.num_workers = 4
    st = sv.Solve(m)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {}
    out = defaultdict(list)
    for i, it in enumerate(items):
        for w in workers:
            if sv.Value(x[i, w]):
                out[w].append((vals[i], it))
    return {w: [it for _, it in sorted(v, key=lambda t: -t[0])] for w, v in out.items()}


def plan_collection(D, today):
    st = D.get('settings', {})
    cap = int(st.get('collector_capacity', 15))
    plans = []
    by_b = defaultdict(list)
    for c in D['late']:
        by_b[c['branch_id']].append(c)
    staff = [p for p in D['staff'] if p['coll'] and p['role'] in ('collector', 'collection_rep')]
    for b, items in by_b.items():
        ws = [p['id'] for p in staff if p['branch_id'] == b] or [p['id'] for p in staff if not p['branch_id']]
        if not ws:
            continue
        cat = lambda d: 1.0 if d <= 30 else 1.25 if d <= 60 else 1.1 if d <= 90 else 0.7

        def val(c):
            return float(c['overdue']) * (1 - min(95, c['risk']) / 130) * cat(c['days_late'])
        res = solve_assignment(items, ws, cap, val, lambda c: c.get('zone_id') or '-', lambda c: c.get('assigned_to'))
        for w, lst in res.items():
            exp = sum(val(c) for c in lst)
            plans.append({'kind': 'collection', 'branch_id': b, 'user_id': w,
                          'summary': f'{len(lst)} زيارة تحصيل — متأخرات {sum(float(c["overdue"]) for c in lst):,.0f} ج — تحصيل متوقع {exp:,.0f} ج',
                          'data': {'items': [{'contract_id': c['contract_id'], 'customer_id': c['customer_id'], 'name': c['name'], 'zone_id': c.get('zone_id'),
                                              'days_late': c['days_late'], 'overdue': c['overdue'], 'risk': c['risk'], 'expected': round(val(c))} for c in lst],
                                   'expected': round(exp)}})
    return plans


def plan_visits(D, today):
    cap = int(D.get('settings', {}).get('visit_capacity', 6))
    plans, by_b = [], defaultdict(list)
    for v in D['visits']:
        by_b[v['branch_id']].append(v)
    staff = [p for p in D['staff'] if p['visit']]
    for b, items in by_b.items():
        ws = [p['id'] for p in staff if p['branch_id'] == b] or [p['id'] for p in staff if not p['branch_id']]
        if not ws:
            continue

        def val(v):
            late = 0
            if v.get('due_date'):
                late = max(0, (datetime.date.fromisoformat(today) - datetime.date.fromisoformat(v['due_date'])).days)
            return 10 + 5 * (v.get('wait_days') or 0) + 15 * late
        res = solve_assignment(items, ws, cap, val, lambda v: v.get('zone_id') or '-', lambda v: v.get('assigned_agent'), keep_bonus=0.4)
        for w, lst in res.items():
            plans.append({'kind': 'investigation', 'branch_id': b, 'user_id': w, 'summary': f'{len(lst)} زيارة استعلام مرتبة بالأولوية والمنطقة',
                          'data': {'items': [{'id': v['id'], 'name': v['name'], 'zone_id': v.get('zone_id'), 'wait_days': v.get('wait_days'), 'due_date': v.get('due_date')} for v in lst]}})
    return plans


def plan_marketing(D, today):
    cap = int(D.get('settings', {}).get('sales_capacity', 20))
    plans, by_b = [], defaultdict(list)
    for r in D['renew']:
        by_b[r['branch_id']].append(r)
    staff = [p for p in D['staff'] if p['follow']]
    for b, items in by_b.items():
        ws = [p['id'] for p in staff if p['branch_id'] == b] or [p['id'] for p in staff if not p['branch_id']]
        if not ws:
            continue
        boost = {'interested': 1.6, 'new': 1.2, 'contacted': 1.0}
        val = lambda r: (r.get('score') or 50) * boost.get(r['status'], 1)
        res = solve_assignment(items, ws, cap, val, lambda r: '-', lambda r: r.get('assigned_to'), lam_zone=0, keep_bonus=0.5)
        for w, lst in res.items():
            plans.append({'kind': 'marketing', 'branch_id': b, 'user_id': w, 'summary': f'{len(lst)} عميل منتهي للتواصل بكرة بالترتيب',
                          'data': {'items': [{'id': r['id'], 'customer_id': r['customer_id'], 'name': r['name'], 'status': r['status'], 'score': r.get('score')} for r in lst]}})
    return plans


def alloc(hist, total, lo=0.9, hi=1.35):
    """GLOP LP: توزيع إجمالي على وحدات بحيث يكون قريب من النسبة التاريخية وجوه حدود واقعية."""
    keys = list(hist)
    if not keys:
        return {}
    H = sum(hist.values())
    s = pywraplp.Solver.CreateSolver('GLOP')
    t, d = {}, {}
    for k in keys:
        share = total * hist[k] / H if H > 0 else total / len(keys)
        lb, ub = (hist[k] * lo, hist[k] * hi) if hist[k] > 0 else (0, total / len(keys))
        t[k] = s.NumVar(lb, max(lb, ub), f't{k[:6]}')
        d[k] = s.NumVar(0, s.infinity(), f'd{k[:6]}')
        s.Add(d[k] >= t[k] - share)
        s.Add(d[k] >= share - t[k])
    s.Add(sum(t.values()) == total)
    s.Minimize(sum(d.values()))
    if s.Solve() != pywraplp.Solver.OPTIMAL:
        f = total / H if H else 0
        return {k: round(hist[k] * f, -2) for k in keys}
    return {k: round(t[k].solution_value(), -2) for k in keys}


def plan_targets(D, today):
    st = D.get('settings', {})
    growth = float(st.get('growth', 0.10))
    rows = D['sales_hist']
    months = sorted({r['m'] for r in rows})[-3:]
    if not months:
        return []
    nb = defaultdict(float)
    ne = defaultdict(lambda: defaultdict(float))
    for r in rows:
        if r['m'] in months:
            nb[r['branch_id']] += float(r['v']) / len(months)
            if r.get('created_by'):
                ne[r['branch_id']][r['created_by']] += float(r['v']) / len(months)
    total = float(st.get('company_target') or 0) or sum(nb.values()) * (1 + growth)
    bt = alloc(dict(nb), total)
    d0 = datetime.date.fromisoformat(today)
    nxt = (d0.replace(day=1) + datetime.timedelta(days=32)).replace(day=1).isoformat()
    names = {b['id']: b['name'] for b in D['branches']}
    plans = []
    for b, tv in bt.items():
        et = alloc(dict(ne[b]), tv) if ne[b] else {}
        plans.append({'kind': 'targets', 'branch_id': b, 'user_id': None,
                      'summary': f'تارجت مقترح لـ {names.get(b, "")} شهر {nxt[:7]}: {tv:,.0f} ج (متوسط آخر {len(months)} شهور {nb[b]:,.0f} ج)',
                      'data': {'month': nxt, 'branch_target': tv, 'branch_avg': round(nb[b]), 'growth': growth,
                               'employees': [{'user_id': u, 'avg': round(ne[b][u]), 'target': v} for u, v in et.items()]}})
    return plans


def demo():
    br = [{'id': 'B1', 'name': 'فرع 1'}, {'id': 'B2', 'name': 'فرع 2'}]
    staff = [{'id': f'C{i}', 'name': f'محصل {i}', 'role': 'collector', 'branch_id': 'B1' if i < 3 else 'B2', 'coll': True, 'visit': False, 'follow': False, 'sales': False} for i in range(1, 5)]
    staff += [{'id': 'A1', 'name': 'استعلام', 'role': 'field_agent', 'branch_id': 'B1', 'coll': False, 'visit': True, 'follow': False, 'sales': False},
              {'id': 'S1', 'name': 'مبيعات', 'role': 'sales', 'branch_id': 'B1', 'coll': False, 'visit': False, 'follow': True, 'sales': True},
              {'id': 'S2', 'name': 'مبيعات 2', 'role': 'sales', 'branch_id': 'B1', 'coll': False, 'visit': False, 'follow': True, 'sales': True}]
    late = [{'contract_id': f'K{i}', 'customer_id': f'U{i}', 'branch_id': 'B1' if i % 3 else 'B2', 'days_late': (i * 7) % 120 + 1, 'overdue': 500 + i * 130,
             'zone_id': f'Z{i % 4}', 'assigned_to': None, 'risk': (i * 13) % 90, 'name': f'عميل {i}'} for i in range(60)]
    visits = [{'id': f'V{i}', 'branch_id': 'B1', 'assigned_agent': None, 'name': f'استعلام {i}', 'zone_id': f'Z{i % 3}', 'wait_days': i % 5, 'due_date': None} for i in range(10)]
    renew = [{'id': f'R{i}', 'branch_id': 'B1', 'assigned_to': 'S1' if i % 2 else None, 'status': ['new', 'contacted', 'interested'][i % 3], 'customer_id': f'U{i}', 'name': f'منتهي {i}', 'score': 30 + i * 2} for i in range(30)]
    hist = [{'branch_id': b, 'created_by': s, 'm': m, 'v': v, 'n': 3} for b, s, v in (('B1', 'S1', 90000), ('B1', 'S2', 60000), ('B2', None, 80000)) for m in ('2026-08-01', '2026-09-01', '2026-10-01')]
    return {'settings': {}, 'today': '2026-11-23', 'branches': br, 'staff': staff, 'late': late, 'visits': visits, 'renew': renew, 'sales_hist': hist}


def main():
    is_demo = '--demo' in sys.argv
    tok = os.environ.get('OPS_TOKEN', '')
    if not is_demo and not tok:
        sys.exit('OPS_TOKEN مش موجود')
    D = demo() if is_demo else rpc('ops_fetch', {'p_token': tok})
    today = D['today']
    plan_date = (datetime.date.fromisoformat(today) + datetime.timedelta(days=1)).isoformat()
    plans = plan_collection(D, today) + plan_visits(D, today) + plan_marketing(D, today) + plan_targets(D, today)
    print(f'{len(plans)} خطة:')
    for p in plans:
        print(' -', p['kind'], p.get('user_id') or p.get('branch_id'), '|', p['summary'])
    if is_demo:
        assert any(p['kind'] == 'collection' for p in plans) and any(p['kind'] == 'targets' for p in plans)
        for p in plans:
            if p['kind'] == 'collection':
                assert len(p['data']['items']) <= 15
        tg = [p for p in plans if p['kind'] == 'targets']
        print('targets total', sum(p['data']['branch_target'] for p in tg))
        return
    n = rpc('ops_save', {'p_token': tok, 'p_date': plan_date, 'p_plans': plans})
    print('اتحفظ', n, 'خطة ليوم', plan_date)


if __name__ == '__main__':
    main()
