#!/usr/bin/env python3
"""LOAD-01 · الدفعة 25 — محلّلُ الموجةِ ومُطبِّقُ قاعدةِ القرارِ المسجَّلةِ مسبقًا.

مُسجَّلٌ ومثبَّتٌ (commit) قبلَ أوّلِ موجةٍ معَ PLAN.md؛ لا تُعدَّلُ عتبةٌ هنا بعدَ رؤيةِ النتيجة.

الاستعمال:
  b25-analyze.py wave  <RAW_WAVE_DIR> <LIMIT>        → JSON مقاييسُ الموجةِ (stdout)
  b25-analyze.py decide <RAW_ROOT> <RUN…>             → JSON مقاييسُ كلِّ الموجاتِ + الحكم

مدخلاتُ الموجةِ (من دليلِ المقعدِ): dispatch-trace.jsonl.gz، orders.csv.gz، gates.txt،
wave-report.json، p4-decompose.out.json، resources.jsonl، sched-samples.jsonl.gz،
conn-samples.csv.gz، pgss-full.csv.gz، timeline.jsonl؛ وصلاحيّةُ الموجةِ من validity.json
على جذرِ الأثر.

تعريفاتٌ (مُعلنةٌ قبلَ القياس):
- نافذةُ الحقنِ = [أوّلُ طلبٍ أُنشئ، آخرُ طلبٍ أُنشئ] منَ orders.csv؛ التصريفُ = ما بعدَها.
- الطابورُ(t) = طلباتٌ أُنشئت حتى t ولم تبلغْ أوّلَ معالجةٍ في الشوطِ حتى t (لا يكونُ سالبًا
  بالتعريفِ — يصحّحُ أثرَ النافذةِ في backlog_every_5s القديم).
- معدّلُ الخدمةِ الفعليُّ = أوّلُ معالجاتٍ (طلباتٌ مختلفةٌ تبلغُ الشوطَ أوّلَ مرّةٍ) في النافذةِ ÷
  طولِها. معدّلُ التنفيذِ = كلُّ معالجاتِ الشوطِ (بالتكرارِ) ÷ طولِها. الطلباتُ المفحوصةُ وحدَها
  ليست مقياسَ نجاحٍ.
- الدورةُ = startAt[i+1] − startAt[i]؛ الفاصلُ = startAt[i+1] − endAt[i]؛ تأخيرُ اللاحقِ =
  startAt − triggeredAt.
- التجميعُ عبرَ الموجاتِ: لكلِّ مقياسٍ قيمةُ الموجةِ، ثمّ وسيطُ الموجاتِ الصالحةِ لكلِّ جانبٍ،
  والمدى (أدنى–أعلى) يُعلَنُ معه.
"""
from __future__ import annotations

import bisect
import csv
import gzip
import io
import json
import re
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

# ---------------------------------------------------------------- عتباتُ القرارِ (مسجَّلةٌ مسبقًا)
P4_LIMIT_MS = 30_000            # حدُّ البروتوكولِ الأصليُّ — لا يُعادُ تعريفُه
SERVICE_MIN_GAIN = 0.10          # وسيطُ C ≥ وسيطِ R × 1.10
QUEUE_END_MAX_SHARE = 0.25       # طابورُ C عندَ نهايةِ الحقنِ ≤ 25% من وسيطِ R
QUEUE_SLOPE_MAX = 0.5            # ميلُ الطابورِ في النصفِ الثاني منَ الحقنِ ≤ 0.5 طلب/ث
DRAIN_MAX_S = 30                 # الطابورُ يبلغُ الصفرَ خلالَ 30s بعدَ نهايةِ الحقن
MIN_VALID_PER_SIDE = 3           # أقلُّ من ذلك = غيرُ حاسمٍ (تُعادُ السلسلةُ كاملةً، لا انتقاء)


def pct(vals, p):
    v = sorted(vals)
    if not v:
        return None
    k = (len(v) - 1) * p / 100
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return round(v[lo] + (v[hi] - v[lo]) * (k - lo), 1)


def summ(vals):
    vals = [x for x in vals if x is not None]
    if not vals:
        return {"n": 0}
    return {"n": len(vals), "p50": pct(vals, 50), "p95": pct(vals, 95), "p99": pct(vals, 99),
            "max": round(max(vals), 1), "mean": round(statistics.fmean(vals), 1)}


def open_text(p: Path):
    if p.suffix == ".gz":
        return io.TextIOWrapper(gzip.open(p), encoding="utf-8")
    return open(p, encoding="utf-8")


def find(d: Path, name: str) -> Path | None:
    for c in (d / name, d / (name + ".gz")):
        if c.exists():
            return c
    return None


def jsonl(p: Path | None):
    if p is None:
        return []
    out = []
    with open_text(p) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return out


def slope(xs, ys):
    if len(xs) < 2:
        return None
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    den = sum((x - mx) ** 2 for x in xs)
    return None if den == 0 else round(sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den, 3)


def parse_gates(d: Path):
    txt = (d / "gates.txt").read_text(encoding="utf-8") if (d / "gates.txt").exists() else ""
    verdict = re.search(r"verdict (\w+) \[([^\]]*)\]", txt)
    vals = dict(re.findall(r"\b(G\d|P\d[abc]?)=([^|]+?)\s*(?:\||$)", txt, re.M))
    rep = {}
    if (d / "wave-report.json").exists():
        w = json.loads((d / "wave-report.json").read_text(encoding="utf-8"))
        rep = {g["id"]: {"value": g.get("value"), "pass": g.get("pass")} for g in w.get("gates", [])}
        verdict_s = w.get("verdict")
        failed = w.get("failedGates", [])
    else:
        verdict_s = verdict.group(1) if verdict else None
        failed = [x.strip(" '") for x in verdict.group(2).split(",")] if verdict and verdict.group(2) else []
    return {"verdict": verdict_s, "failed": failed, "summary_line": {k: v.strip() for k, v in vals.items()},
            "gates": rep}


def resources(out: dict, d: Path, t0: float, t1: float, probes: list) -> None:
    """الموارد: CPU (resources.jsonl)، PSI (sched)، زمنُ تنفيذِ الاستعلامِ (pgss)، انتظارُ الاتصالِ (probe/conn) — منفصلةً."""
    res = jsonl(d / "resources.jsonl") if (d / "resources.jsonl").exists() else []
    t0s, t1s = t0 / 1000, t1 / 1000
    rw = [r for r in res if t0s <= r.get("t", 0) <= t1s]
    out["cpu_pct_window"] = {
        k: summ([(r.get(k) or {}).get("cpu_pct") for r in rw]) for k in ("gateway", "postgres", "generator")}
    sched = [s for s in jsonl(find(d, "sched-samples.jsonl")) if s.get("k") == "sched" and t0 <= s["t"] <= t1]
    out["psi_some_pct_window"] = summ([s.get("psi_some_pct") for s in sched])
    out["pg_runq_wait_pct_window"] = summ([(s.get("postgres") or {}).get("runq_wait_pct_1core") for s in sched])
    out["pool_acquire_select1_ms"] = summ([x.get("poolMs") for x in probes if t0 <= x["at"] <= t1])
    cs = find(d, "conn-samples.csv")
    if cs is not None:
        waits = defaultdict(int)
        with open_text(cs) as f:
            for row in csv.reader(f):
                if len(row) == 4 and row[0].isdigit() and t0 <= float(row[0]) <= t1:
                    waits[f"{row[1]}|{row[2]}"] += int(row[3])
        out["conn_states_window"] = dict(sorted(waits.items()))
    pg = find(d, "pgss-full.csv")
    if pg is not None:
        with open_text(pg) as f:
            rows = list(csv.DictReader(f))
        tot = sum(float(r["total_ms"]) for r in rows)
        top = sorted(rows, key=lambda r: -float(r["total_ms"]))[:8]
        out["pg_exec"] = {"total_exec_ms": round(tot, 1), "top": [
            {"calls": int(r["calls"]), "total_ms": round(float(r["total_ms"]), 1),
             "mean_ms": round(float(r["mean_ms"]), 3), "query": r["query"][:90]} for r in top]}


def wave(d: Path, limit: int) -> dict:
    trace = jsonl(find(d, "dispatch-trace.jsonl"))
    passes = sorted((t for t in trace if t.get("k") == "pass"), key=lambda t: t["startAt"])
    orders_tr = [t for t in trace if t.get("k") == "order"]
    probes = [t for t in trace if t.get("k") == "probe"]

    created = {}
    p = find(d, "orders.csv")
    if p is not None:
        with open_text(p) as f:
            for r in csv.DictReader(f):
                created[r["id"]] = float(r["created_ms"])
    first_exec = {}
    for o in sorted(orders_tr, key=lambda o: o["startAt"]):
        first_exec.setdefault(o["orderId"], o["startAt"])

    out: dict = {"wave": d.name, "limit": limit, "inputs": {
        "orders_csv": p is not None, "trace_passes": len(passes), "trace_orders": len(orders_tr)}}
    out["gates"] = parse_gates(d)
    p4d = d / "p4-decompose.out.json"
    if p4d.exists():
        dd = json.JSONDecoder().raw_decode(p4d.read_text(encoding="utf-8"))[0]
        out["P4"] = dd.get("P4")
        out["queue_before_first_exec_ms"] = dd.get("queue_before_first_exec_ms")
        out["first_exec_ms"] = dd.get("first_exec_ms")
        out["target_in_round1_share"] = dd.get("target_in_round1_share")

    if not passes:
        out["error"] = "مدخلاتٌ ناقصةٌ (أثرُ الشوط)"
        return out
    if not created:
        # بلا orders.csv لا تُحسبُ مقاييسُ الطابورِ — يُعلَّمُ نقصًا ولا يُقدَّرُ؛ الموارد تُحسبُ
        # على نافذةِ الأشواطِ للتشخيصِ فقط.
        out["error"] = "مدخلاتٌ ناقصةٌ (orders.csv)"
        resources(out, d, passes[0]["startAt"], passes[-1]["endAt"], probes)
        return out

    cr = sorted(created.values())
    t0, t1 = cr[0], cr[-1]
    span = (t1 - t0) / 1000
    win = [x for x in passes if t0 <= x["startAt"] <= t1]
    drain = [x for x in passes if x["startAt"] > t1]
    execs_win = [o for o in orders_tr if t0 <= o["startAt"] <= t1]
    first_win = [oid for oid, ts in first_exec.items() if oid in created and t0 <= ts <= t1]

    def counts(ps):
        c = Counter()
        for x in ps:
            for k in ("picked", "rebroadcast", "stillNoDriver", "exhausted", "raced", "failed"):
                c[k] += int(x.get(k) or 0)
        return dict(c)

    cyc = [b["startAt"] - a["startAt"] for a, b in zip(win, win[1:])]
    gap = [b["startAt"] - a["endAt"] for a, b in zip(win, win[1:])]
    out["window"] = {"inject_sec": round(span, 1), "orders": len(cr)}
    out["passes"] = {
        "in_window": len(win), "in_drain": len(drain),
        "per_s": round(len(win) / span, 3) if span else None,
        "saturated_share": round(sum(1 for x in win if x["picked"] >= limit) / len(win), 3) if win else None,
        "passMs": summ([x["passMs"] for x in win]),
        "cycle_ms": summ(cyc), "gap_ms": summ(gap),
        "followup_delay_ms": summ([x["startAt"] - x["triggeredAt"] for x in win if x.get("triggeredAt")]),
        "finderMs": summ([x.get("finderMs") for x in win]),
        "picked": summ([x["picked"] for x in win]),
        "longer_than_2s": sum(1 for x in win if x["passMs"] > 2000),
        "counts_window": counts(win), "counts_drain": counts(drain),
    }
    out["rates"] = {
        "arrival_per_s": round(len(cr) / span, 2) if span else None,
        "first_exec_per_s": round(len(first_win) / span, 2) if span else None,
        "exec_per_s": round(len(execs_win) / span, 2) if span else None,
        "repeat_share": round(1 - len(first_win) / len(execs_win), 3) if execs_win else None,
        "per_order_exec_ms": summ([o["totalMs"] for o in execs_win]),
    }
    # الطابورُ: لا سالبَ بالتعريف. يُحسبُ على الطلباتِ التي بلغت الشوطَ يومًا (أُخدِمت)؛ ما لم
    # يبلغْه قطُّ (أُلغيَ أو انتهى قبلَ الشوطِ) يُعدُّ منفصلًا ولا يُبقي الطابورَ «غيرَ مصرَّفٍ» زيفًا.
    served = {oid for oid in created if oid in first_exec}
    out["window"]["never_reached_pass"] = len(created) - len(served)
    cr_served = sorted(created[o] for o in served)
    fe_sorted = sorted(first_exec[o] for o in served)
    series = []
    end_ms = max(t1 + 180_000, passes[-1]["endAt"])
    ms = t0
    while ms <= end_ms:
        q = bisect.bisect_right(cr_served, ms) - bisect.bisect_right(fe_sorted, ms)
        series.append({"t": round((ms - t0) / 1000), "queue": max(q, 0)})
        ms += 5_000
    inj = [s for s in series if s["t"] <= span]
    half = [s for s in inj if s["t"] >= span / 2]
    q_end = inj[-1]["queue"] if inj else None
    drained = next((s["t"] - span for s in series if s["t"] > span and s["queue"] == 0), None)
    out["queue"] = {
        "max": max(s["queue"] for s in series), "at_inject_end": q_end,
        "slope_second_half_per_s": slope([s["t"] for s in half], [s["queue"] for s in half]),
        "drain_to_zero_s": None if drained is None else round(drained, 1),
        "every_5s": series,
    }
    resources(out, d, t0, t1, probes)
    return out


def med(xs):
    xs = [x for x in xs if x is not None]
    return None if not xs else statistics.median(xs)


def stat(vals):
    """وسيطٌ ومدى؛ القيمةُ الناقصةُ (None) تُبقي المعيارَ ساقطًا لا مُتخطّى."""
    xs = [x for x in vals if x is not None]
    return {"median": med(xs), "min": min(xs) if xs else None, "max": max(xs) if xs else None,
            "values": vals, "missing": len(vals) - len(xs)}


def lt(a, b):
    return a is not None and b is not None and a < b


def decide(root: Path, runs: list[str]) -> dict:
    waves = {}
    for r in runs:
        side = "R" if "-R" in r else "C"
        limit = 50 if side == "R" else 100
        w = wave(root / "raw" / r, limit)
        w["side"] = side
        # الصلاحيّةُ لكلِّ موجةٍ: قبلَ الحقنِ (preflight) وأثناءَه وبعدَه (inflight يشملُ مسابرَ
        # ما بعدَ الموجةِ post_speed/post_pg) — حكمُ المقعدِ الآليُّ بقاعدةِ B23-RUNNER-V1.
        q = root / "raw" / r / "qual"
        vv = {}
        for k in ("preflight", "inflight"):
            f = q / f"{k}.json"
            vv[k] = json.loads(f.read_text(encoding="utf-8")).get("verdict") if f.exists() else "MISSING"
        w["validity"] = vv
        waves[r] = w

    def valid(w):
        ok_v = all(v == "VALID" for v in w["validity"].values())
        return ok_v and "error" not in w and w["gates"]["verdict"] is not None

    R = [w for w in waves.values() if w["side"] == "R" and valid(w)]
    C = [w for w in waves.values() if w["side"] == "C" and valid(w)]
    res = {"valid": {"R": [w["wave"] for w in R], "C": [w["wave"] for w in C]},
           "excluded": {k: {"validity": w["validity"], "error": w.get("error"),
                            "verdict": w["gates"]["verdict"]}
                        for k, w in waves.items() if not valid(w)}}
    if len(R) < MIN_VALID_PER_SIDE or len(C) < MIN_VALID_PER_SIDE:
        res["decision"] = "INCONCLUSIVE"
        res["why"] = f"أقلُّ من {MIN_VALID_PER_SIDE} موجاتٍ صالحةٍ لجانبٍ"
        return {"waves": waves, "result": res}

    def side_vals(ws, f):
        return [f(w) for w in ws]

    fe = lambda w: w["rates"]["first_exec_per_s"]
    p4 = lambda w: (w.get("P4") or {}).get("p95")
    qend = lambda w: w["queue"]["at_inject_end"]
    agg = {}
    for name, f in (("first_exec_per_s", fe), ("exec_per_s", lambda w: w["rates"]["exec_per_s"]),
                    ("arrival_per_s", lambda w: w["rates"]["arrival_per_s"]), ("P4_p95_ms", p4),
                    ("queue_at_inject_end", qend), ("passMs_p50", lambda w: w["passes"]["passMs"].get("p50")),
                    ("passMs_p95", lambda w: w["passes"]["passMs"].get("p95")),
                    ("cycle_ms_p50", lambda w: w["passes"]["cycle_ms"].get("p50")),
                    ("qbfe_p95_ms", lambda w: (w.get("queue_before_first_exec_ms") or {}).get("p95"))):
        rv, cv = side_vals(R, f), side_vals(C, f)
        agg[name] = {"R": stat(rv), "C": stat(cv)}
    res["aggregate"] = agg

    crit = {}
    A = lambda k, side, f: agg[k][side][f]
    crit["a_all_C_gates_pass"] = all(w["gates"]["verdict"] == "PASS" for w in C)
    crit["b_P4_each_C_le_30s"] = all(p4(w) is not None and p4(w) <= P4_LIMIT_MS for w in C)
    r_spread = (None if A("P4_p95_ms", "R", "max") is None
                else A("P4_p95_ms", "R", "max") - A("P4_p95_ms", "R", "min"))
    gain = (None if A("P4_p95_ms", "R", "min") is None or A("P4_p95_ms", "C", "max") is None
            else A("P4_p95_ms", "R", "min") - A("P4_p95_ms", "C", "max"))
    crit["b2_P4_gain_beyond_R_jitter"] = (agg["P4_p95_ms"]["C"]["missing"] == 0 and lt(r_spread, gain))
    crit["c_service_separated"] = (
        agg["first_exec_per_s"]["C"]["missing"] == 0
        and lt(A("first_exec_per_s", "R", "max"), A("first_exec_per_s", "C", "min"))
        and A("first_exec_per_s", "C", "median") is not None
        and A("first_exec_per_s", "C", "median") >= A("first_exec_per_s", "R", "median") * (1 + SERVICE_MIN_GAIN))
    rq = A("queue_at_inject_end", "R", "median")
    crit["d_queue_recedes"] = rq is not None and all(
        (qend(w) is not None and qend(w) <= QUEUE_END_MAX_SHARE * rq)
        and (w["queue"]["slope_second_half_per_s"] is not None
             and w["queue"]["slope_second_half_per_s"] <= QUEUE_SLOPE_MAX)
        and (w["queue"]["drain_to_zero_s"] is not None and w["queue"]["drain_to_zero_s"] <= DRAIN_MAX_S)
        for w in C)
    res["criteria"] = crit
    res["decision"] = "POSITIVE" if all(crit.values()) else "FAIL"
    return {"waves": waves, "result": res}


def main() -> int:
    if len(sys.argv) >= 4 and sys.argv[1] == "wave":
        print(json.dumps(wave(Path(sys.argv[2]), int(sys.argv[3])), ensure_ascii=False, indent=1))
        return 0
    if len(sys.argv) >= 4 and sys.argv[1] == "decide":
        print(json.dumps(decide(Path(sys.argv[2]), sys.argv[3:]), ensure_ascii=False, indent=1))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
