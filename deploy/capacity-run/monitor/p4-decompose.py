#!/usr/bin/env python3
"""LOAD-01 · P4 — تفكيكُ زمنِ ظهورِ العرضِ لكلِّ طلبٍ من الأدلّةِ الخامِ وحدَها.

المدخلاتُ (كلُّها في مجلّدِ أدلّةِ الموجةِ، وتُعادُ منها النتيجةُ حرفيّاً):
  miniapp-load-events.jsonl   أحداثُ المولّدِ (orderCreatedAt/offerFoundAt لكلِّ سيناريو)
  dispatch-trace.jsonl        أثرُ البوابةِ (pass/order/probe) — DISPATCH_TRACE_FILE
  offers.csv                  order_offers من القاعدةِ بعدَ الموجةِ مع telegram_id للسائقِ
  orders.csv                  orders (id, created_ms, broadcast_round, status)
  resources.jsonl             عيّناتُ CPU/الذاكرةِ للمقعدِ (اختياريٌّ)

المخرجُ: p4-decompose.json + نصٌّ مختصرٌ على stdout.

مراحلُ الطلبِ (مرتبطةٌ بمعرّفِ الطلبِ):
  queue      = بدءُ معالجةِ الطلبِ لأوّلِ مرّةٍ في شوطٍ − إنشاؤه (انتظارُ الطابورِ/الشوطِ)
  firstExec  = مدّةُ أوّلِ معالجةٍ (I/O لكلِّ منفذٍ + كلفةُ الذاكرةِ)
  toTarget   = أوّلُ عرضٍ لسائقِ السيناريو نفسِه − إنشاءُ الطلبِ (من القاعدةِ)
  boardLag   = ظهورُه على لوحِ السائقِ (المولّد) − كتابةُ العرضِ لسائقِ السيناريو
"""
import csv
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path


def pct(vals, p):
    if not vals:
        return None
    s = sorted(vals)
    k = max(0, min(len(s) - 1, int(round(p / 100 * len(s) + 0.5)) - 1))
    return s[k]


def summ(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return {"n": 0}
    return {
        "n": len(vals),
        "p50": round(statistics.median(vals), 1),
        "p95": round(pct(vals, 95), 1),
        "p99": round(pct(vals, 99), 1),
        "max": round(max(vals), 1),
        "mean": round(statistics.fmean(vals), 1),
    }


def main(ev_dir: str) -> None:
    d = Path(ev_dir)
    scen = {}
    for line in open(d / "miniapp-load-events.jsonl"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("event") == "scenario.outcome" and e.get("orderId"):
            scen[e["orderId"]] = e
    created = {}
    rounds = {}
    for r in csv.DictReader(open(d / "orders.csv")):
        created[r["id"]] = float(r["created_ms"])
        rounds[r["id"]] = int(r["broadcast_round"])
    offers = defaultdict(list)
    for r in csv.DictReader(open(d / "offers.csv")):
        offers[r["order_id"]].append(
            (int(r["round"]), float(r["created_ms"]), r["telegram_id"], r["status"])
        )

    trace = [json.loads(x) for x in open(d / "dispatch-trace.jsonl") if x.strip()]
    passes = [t for t in trace if t["k"] == "pass"]
    orders = [t for t in trace if t["k"] == "order"]
    probes = [t for t in trace if t["k"] == "probe"]
    first_exec = {}
    exec_count = Counter()
    for o in orders:
        exec_count[o["orderId"]] += 1
        if o["orderId"] not in first_exec:
            first_exec[o["orderId"]] = o

    p4, queue, fexec, to_target, board_lag, target_round, round1_hit = [], [], [], [], [], [], []
    for oid, e in scen.items():
        if e.get("offerFoundAt") is None or e.get("orderCreatedAt") is None:
            continue
        p4.append(e["offerFoundAt"] - e["orderCreatedAt"])
        c = created.get(oid, e["orderCreatedAt"])
        fe = first_exec.get(oid)
        if fe:
            queue.append(fe["startAt"] - c)
            fexec.append(fe["totalMs"])
        tgt = [o for o in offers.get(oid, []) if o[2] == str(e.get("driver"))]
        if tgt:
            t = min(tgt, key=lambda x: x[1])
            to_target.append(t[1] - c)
            board_lag.append(e["offerFoundAt"] - t[1])
            target_round.append(t[0])
            round1_hit.append(1 if t[0] == 1 else 0)

    # كلفةُ المعالجةِ لكلِّ منفذٍ
    phase_vals = defaultdict(list)
    for o in orders:
        for k, v in o["phases"].items():
            phase_vals[k].append(v)
        phase_vals["residual(non-io)"].append(o["residualMs"])
        phase_vals["total"].append(o["totalMs"])

    # معدّلاتُ الوصولِ والخدمةِ داخلَ نافذةِ الحِملِ
    cr = sorted(created[o] for o in scen if o in created)
    t0, t1 = (cr[0], cr[-1]) if cr else (0, 1)
    span = max(1.0, (t1 - t0) / 1000)
    arrivals = len(cr) / span
    in_win = [o for o in orders if t0 <= o["startAt"] <= t1]
    first_in_win = [o for o in in_win if first_exec.get(o["orderId"]) is o]
    busy = sum(p["passMs"] for p in passes if t0 <= p["startAt"] <= t1)
    exec_ms_per_order = statistics.fmean([o["totalMs"] for o in in_win]) if in_win else None
    # المعالجاتُ التي ليست أوّلَ عرضٍ للطلبِ (إعادةُ بثٍّ وعرضُه ما زالَ حيّاً أو بعدَ انتهائِه)
    repeat_in_win = len(in_win) - len(first_in_win)

    # تراكمُ الطابورِ الفعليُّ: عددُ الطلباتِ المنشأةِ ولم تُعالَجْ بعدُ لكلِّ ثانيةٍ
    backlog = []
    fe_times = sorted(first_exec[o]["startAt"] for o in first_exec if o in created)
    import bisect

    for s in range(int(t0 / 1000), int(t1 / 1000) + 1, 5):
        ms = s * 1000
        n_created = bisect.bisect_right(cr, ms)
        n_served = bisect.bisect_right(fe_times, ms)
        backlog.append({"t": round((ms - t0) / 1000), "backlog": n_created - n_served})

    pass_win = [p for p in passes if t0 <= p["startAt"] <= t1]
    gaps = []
    for a, b in zip(pass_win, pass_win[1:]):
        gaps.append(b["startAt"] - a["endAt"])

    out = {
        "scenarios": len(scen),
        "P4": summ(p4),
        "queue_before_first_exec_ms": summ(queue),
        "first_exec_ms": summ(fexec),
        "order_created_to_target_offer_ms": summ(to_target),
        "target_offer_to_board_seen_ms": summ(board_lag),
        "target_offer_round": dict(Counter(target_round)),
        "target_in_round1_share": round(statistics.fmean(round1_hit), 4) if round1_hit else None,
        "phase_ms_per_order_exec": {k: summ(v) for k, v in phase_vals.items()},
        "exec_count_per_order": dict(Counter(exec_count.values())),
        "final_broadcast_round": dict(Counter(rounds.values())),
        "rates": {
            "window_sec": round(span, 1),
            "arrival_per_s": round(arrivals, 2),
            "order_execs_in_window": len(in_win),
            "first_execs_in_window": len(first_in_win),
            "repeat_execs_in_window": repeat_in_win,
            "repeat_share": round(repeat_in_win / len(in_win), 4) if in_win else None,
            "exec_ms_mean": round(exec_ms_per_order, 1) if exec_ms_per_order else None,
            "serial_service_capacity_per_s": round(1000 / exec_ms_per_order, 2) if exec_ms_per_order else None,
            "effective_new_order_rate_per_s": round(len(first_in_win) / span, 2),
            "dispatcher_busy_share": round(busy / (span * 1000), 4),
        },
        "passes": {
            "n_in_window": len(pass_win),
            "passMs": summ([p["passMs"] for p in pass_win]),
            "picked": summ([p["picked"] for p in pass_win]),
            "gap_between_passes_ms": summ(gaps),
            "finderMs": summ([p["finderMs"] for p in pass_win]),
            "trigger_to_start_ms": summ(
                [p["startAt"] - p["triggeredAt"] for p in pass_win if p.get("triggeredAt")]
            ),
        },
        "probes": {
            "pool_select1_ms": summ([p["poolMs"] for p in probes if p["poolMs"] is not None]),
            "direct_select1_ms": summ([p["directMs"] for p in probes if p["directMs"] is not None]),
            "loop_p99_ms": summ([p["loopP99Ms"] for p in probes]),
            "loop_max_ms": summ([p["loopMaxMs"] for p in probes]),
            "gateway_cpu_pct": summ([p["cpuPct"] for p in probes if p["cpuPct"] is not None]),
            "gateway_rss_mb": summ([p["rssMb"] for p in probes]),
        },
        "backlog_every_5s": backlog,
    }
    res = d / "resources.jsonl"
    if res.exists():
        rows = [json.loads(x) for x in open(res) if x.strip()]
        keys = [k for k in (rows[0] if rows else {}) if isinstance(rows[0][k], (int, float))]
        out["seat_resources"] = {k: summ([r[k] for r in rows if isinstance(r.get(k), (int, float))]) for k in keys}
    (d / "p4-decompose.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    show = {k: v for k, v in out.items() if k != "backlog_every_5s"}
    print(json.dumps(show, ensure_ascii=False, indent=1))
    print("backlog:", " ".join(f"{b['t']}s:{b['backlog']}" for b in backlog))


if __name__ == "__main__":
    main(sys.argv[1])
