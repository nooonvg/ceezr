#!/usr/bin/env python3
"""LOAD-01 ب25 — تحليلٌ وصفيٌّ لاحقٌ (لا يدخلُ قاعدةَ القرارِ المسجَّلةَ): النافذةُ النظيفةُ
قبلَ أوّلِ رفضِ 429 لمبادلةِ الجلسةِ في موجاتِ C، والنافذةُ نفسُها (الإزاحةُ نفسُها منَ
بدءِ الحقنِ) في موجاتِ R — لعزلِ أثرِ حدِّ الشوطِ عن عاصفةِ إعادةِ المحاولاتِ.

الاستعمال: b25-prestorm.py RAW_ROOT  → JSON
"""
import csv, gzip, io, json, statistics, sys, bisect
from datetime import datetime
from pathlib import Path

def ms(t): return datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp() * 1000
def pct(v, p):
    v = sorted(v)
    if not v: return None
    k = (len(v) - 1) * p / 100; lo = int(k); hi = min(lo + 1, len(v) - 1)
    return round(v[lo] + (v[hi] - v[lo]) * (k - lo))

root = Path(sys.argv[1]) / "raw"
waves = sorted(p.name for p in root.iterdir() if p.name.startswith("b25-s1-"))
info = {}
for w in waves:
    d = root / w
    ev = [json.loads(l) for l in gzip.open(d / "miniapp-load-events.jsonl.gz")]
    start = next(ms(e["t"]) for e in ev if e.get("event") == "phase.start")
    first429 = min((ms(e["t"]) for e in ev if e.get("event") == "scenario.outcome"
                    and "429" in str(e.get("reason", ""))), default=None)
    info[w] = {"start": start, "first429_s": None if first429 is None else round((first429 - start) / 1000, 1), "ev": ev}
c_storm = [v["first429_s"] for k, v in info.items() if "-C" in k and v["first429_s"] is not None]
cut = min(c_storm) if c_storm else 60.0
win_s = int(cut // 5 * 5)  # نافذةٌ موحَّدةٌ لكلِّ الموجاتِ: حتى أبكرِ عاصفةٍ مقرَّبةً لأسفلِ 5s
out = {"window_from_inject_start_s": [0, win_s], "first_429_s_per_wave": {k: v["first429_s"] for k, v in info.items()}, "waves": {}}
for w in waves:
    d = root / w; st = info[w]["start"]; t1 = st + win_s * 1000
    ok = [e for e in info[w]["ev"] if e.get("event") == "scenario.outcome" and not e.get("reason") and st <= ms(e["t"]) <= t1]
    created = {}
    with io.TextIOWrapper(gzip.open(d / "orders.csv.gz")) as f:
        for r in csv.DictReader(f): created[r["id"]] = float(r["created_ms"])
    tr = [json.loads(l) for l in gzip.open(d / "dispatch-trace.jsonl.gz")]
    fe = {}
    for o in sorted((t for t in tr if t.get("k") == "order"), key=lambda o: o["startAt"]):
        fe.setdefault(o["orderId"], o["startAt"])
    passes = [t for t in tr if t.get("k") == "pass" and st <= t["startAt"] <= t1]
    cr = sorted(v for v in created.values() if st <= v <= t1)
    srv = sorted(fe[o] for o, c in created.items() if o in fe and st <= c <= t1)
    crs = sorted(created[o] for o in created if o in fe and st <= created[o] <= t1)
    q_end = bisect.bisect_right(crs, t1) - bisect.bisect_right(srv, t1)
    qb = [fe[o] - c for o, c in created.items() if o in fe and st <= c <= t1]
    # P4 لطلباتٍ أُنشئت في النافذة (offerFoundAt − orderCreatedAt من حدثِ دورةِ العرض)
    p4 = [e["offerFoundAt"] - e["orderCreatedAt"] for e in info[w]["ev"]
          if e.get("event") == "scenario.outcome" and e.get("offerFoundAt") and e.get("orderCreatedAt")
          and st <= e["orderCreatedAt"] <= t1]
    out["waves"][w] = {
        "completed_per_s": round(len(ok) / win_s, 2),
        "orders_created_per_s": round(len(cr) / win_s, 2),
        "first_exec_per_s": round(sum(1 for o, c in created.items() if o in fe and st <= fe[o] <= t1) / win_s, 2),
        "queue_at_window_end": max(q_end, 0),
        "qbfe_ms_p50_p95": [pct(qb, 50), pct(qb, 95)],
        "P4_ms_p50_p95_created_in_window": [pct(p4, 50), pct(p4, 95)] if p4 else None,
        "passMs_p50_p95": [pct([p["passMs"] for p in passes], 50), pct([p["passMs"] for p in passes], 95)],
        "passes": len(passes), "picked_mean": round(statistics.fmean([p["picked"] for p in passes]), 1) if passes else None,
    }
print(json.dumps(out, ensure_ascii=False, indent=1))
