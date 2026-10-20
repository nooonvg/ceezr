#!/usr/bin/env python3
"""LOAD-01 · الدفعة 26 — محلّلُ الموجةِ ومُطبِّقُ قاعدةِ القرارِ المسجَّلةِ مسبقًا (PLAN-b26.md).

مُثبَّتٌ (commit) قبلَ أوّلِ موجةٍ معَ PLAN-b26.md وb26-session-limit.env؛ لا تُعدَّلُ عتبةٌ بعدَ رؤيةِ النتيجة.
يُعيدُ استعمالَ مقاييسِ b25-analyze.py حرفيًّا (الطابورُ، الشوطُ، المعدّلاتُ، الموارد) وعتباتِه نفسَها،
ويضيفُ: شرطَ القياسِ (الحدُّ الفعليُّ = القيمةُ المعلنة، ولا 429 من حدِّ الجلسة)، وتفصيلَ مصادرِ 429،
واستهلاكَ نافذةِ الحدّ، ومعدّلَ الرحلاتِ المكتملةِ المثبتة، والمعيارَ e.

الاستعمال:
  b26-analyze.py wave     <RAW_WAVE_DIR> <IMMEDIATE_LIMIT> <SESSION_LIMIT>   → JSON
  b26-analyze.py validity <OUT> <RUN…>        → يطبعُ ALL_VALID أو NOT_ALL_VALID (+ JSON على stderr)
  b26-analyze.py smoke    <OUT> <RUN> <SESSION_LIMIT>                      → JSON + SMOKE_OK/SMOKE_FAIL
  b26-analyze.py decide   <OUT> <SESSION_LIMIT> <RUN…>                     → JSON (الحكم)

تعريفاتٌ إضافيّةٌ (مُعلنةٌ قبلَ القياس):
- 429 حدِّ الجلسة = أحداثُ المولّدِ التي سبُبها 429 في خطوةِ الجلسة: تسجيلُ السائقِ
  (driver.onboarding_failed · steps.session=http_429) أو rider_session/driver_session بـ HTTP 429.
  المسارُ الوحيدُ لـ POST /v1/session/telegram في المولّد؛ لا 429 آخرُ يُنسَبُ إليه.
- 429 القبول = نتائجُ reason=accept:429. 429 Telegram الصادر = rejected_429 في المحاكي (بعد − قبل).
- api429 = عدّادُ المولّدِ الكلّيُّ (load-events.jsonl، آخرُ لقطة) — يغطّي نداءاتِ Mini App المسجَّلةَ فقط؛
  تسجيلُ السائقِ يمرُّ بـ http() الخامِ فلا يدخلُه (ولا يدخلُ مقامَ P8) — يُبلَّغُ منفصلًا لا يُعادُ تعريفُ P8.
- المتبقّي غيرُ المنسوب = api429 − (rider/driver_session 429) − accept:429؛ يُعلَنُ كما هو.
- استهلاكُ النافذة = أقصى ZCOUNT(آخرُ 60s) لمفتاحِ الحدِّ في Redis كلَّ ثانية ÷ الحدّ.
- الرحلاتُ المكتملةُ/ث = نتائجُ verified بين phase.start وphase.drain_start ÷ طولِها.
"""
from __future__ import annotations

import datetime
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

_spec = importlib.util.spec_from_file_location("b25", Path(__file__).with_name("b25-analyze.py"))
b25 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(b25)  # type: ignore[union-attr]

# ---------------------------------------------------------------- عتباتُ القرارِ (مسجَّلةٌ مسبقًا)
P4_LIMIT_MS = b25.P4_LIMIT_MS            # 30_000 — حدُّ البروتوكولِ الأصليّ
SERVICE_MIN_GAIN = b25.SERVICE_MIN_GAIN  # 0.10
QUEUE_END_MAX_SHARE = b25.QUEUE_END_MAX_SHARE  # 0.25
QUEUE_SLOPE_MAX = b25.QUEUE_SLOPE_MAX    # 0.5 طلب/ث
DRAIN_MAX_S = b25.DRAIN_MAX_S            # 30
COMPLETIONS_MIN_GAIN = 0.10              # e: وسيطُ C ≥ وسيطِ R × 1.10 وأدنى C > أعلى R
SERIES_SIZE = 8                          # كلُّ موجاتِ السلسلةِ صالحةٌ وإلّا تُعادُ السلسلةُ كاملة
ROUTE = "POST /v1/session/telegram"
jsonl, find, summ, stat, lt, med = b25.jsonl, b25.find, b25.summ, b25.stat, b25.lt, b25.med


def ts(s: str) -> float:
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000


def read_json(p: Path):
    try:
        return json.JSONDecoder().raw_decode(p.read_text(encoding="utf-8").strip())[0]
    except (OSError, ValueError):
        return None


def session_step(e: dict) -> str | None:
    if e.get("event") == "driver.onboarding_failed" and (e.get("steps") or {}).get("session") == "http_429":
        return "driver_onboarding"
    if e.get("event") == "scenario.outcome":
        r = str(e.get("reason") or "")
        if "429" in r and "rider_session" in r:
            return "rider_session"
        if "429" in r and "driver_session" in r:
            return "driver_session"
    return None


def all_gates(d: Path) -> dict:
    w = read_json(d / "wave-report.json") or {}
    rows = {g["id"]: {"value": g.get("value"), "pass": g.get("pass"), "rule": g.get("rule")}
            for g in (w.get("gates") or []) + (w.get("perf") or [])}
    return {"verdict": w.get("verdict"), "failed": w.get("failedGates", []), "rows": rows,
            "total": w.get("total"), "verified": w.get("verified")}


def extras(d: Path, session_limit: int) -> dict:
    ev = jsonl(find(d, "miniapp-load-events.jsonl"))
    out: dict = {}
    try:
        t0 = ts(next(e["t"] for e in ev if e.get("event") == "phase.start"))
        t1 = ts(next(e["t"] for e in ev if e.get("event") == "phase.drain_start"))
    except StopIteration:
        return {"error": "أحداثُ المولّدِ ناقصة"}
    outs = [e for e in ev if e.get("event") == "scenario.outcome"]
    ver = [e for e in outs if e.get("kind") == "verified"]
    inj = (t1 - t0) / 1000
    out["completions"] = {
        "inject_s": round(inj, 1),
        "verified_in_inject": sum(1 for e in ver if t0 <= ts(e["t"]) < t1),
        "verified_per_s": round(sum(1 for e in ver if t0 <= ts(e["t"]) < t1) / inj, 2) if inj else None,
        "verified_total": len(ver), "scenarios_total": len(outs),
        "not_verified_reasons": dict(sorted(Counter(
            str(e.get("reason")) for e in outs if e.get("kind") != "verified").items())),
    }
    # ---- مبادلاتُ الجلسة: المعروضُ (أثرُ البوابة) والمرفوضُ (المولّد) والمقبول
    steps = Counter()
    rej_t = []
    for e in ev:
        s = session_step(e)
        if s:
            steps[s] += 1
            rej_t.append(ts(e["t"]))
    tr = sorted((x["at"], x["n"]) for x in jsonl(find(d, "load-trace.jsonl"))
                if x.get("k") == "http" and x.get("route") == ROUTE and "at" in x)
    offered = sum(n for _, n in tr)
    bins = [n for _, n in tr]
    max60 = max((sum(bins[i:i + 12]) for i in range(max(1, len(bins) - 11))), default=0)
    rl = [r for r in jsonl(find(d, "rl-window.jsonl"))]
    rlw = [r.get("window_max") for r in rl if "window_max" in r]
    sl = read_json(d / "session-limit.json") or {}
    out["session_exchange"] = {
        "limit_check": sl,
        "offered": offered, "rejected_429_by_step": dict(steps), "rejected_429": sum(steps.values()),
        "accepted": offered - sum(steps.values()),
        "offered_per_s_inject": round(sum(n for at, n in tr if t0 <= at <= t1) / inj, 1) if inj else None,
        "first_429_s": round((min(rej_t) - t0) / 1000, 1) if rej_t else None,
        "max_sliding60_offered_bins": max60,
        "redis_window": {"samples": len(rl), "errors": sum(1 for r in rl if "error" in r),
                         "max": max(rlw) if rlw else None,
                         "max_utilisation": round(max(rlw) / session_limit, 4) if rlw else None,
                         "p50": b25.pct(rlw, 50) if rlw else None},
    }
    # ---- مصادرُ 429 و5xx
    rows = [r for r in jsonl(find(d, "load-events.jsonl")) if r.get("path") == "miniapp_http" and r.get("event") is None]
    last = rows[-1] if rows else {}
    req = sum(int(last.get(k) or 0) for k in ("http2xx", "http5xx", "http4xx", "api429", "networkErrors"))
    acc429 = sum(1 for e in outs if str(e.get("reason")) == "accept:429")
    mpre, mpost = read_json(d / "mock-stats-pre.json") or {}, read_json(d / "mock-stats-post.json") or {}
    tg = (None if "rejected_429" not in mpost else int(mpost.get("rejected_429") or 0) - int(mpre.get("rejected_429") or 0))
    api429 = int(last.get("api429") or 0) if rows else None
    in_counter = steps.get("rider_session", 0) + steps.get("driver_session", 0)
    gw5 = Counter()
    for x in jsonl(find(d, "load-trace.jsonl")):
        if x.get("k") == "http" and x.get("errors"):
            gw5[x.get("route")] += int(x["errors"])
    out["errors"] = {
        "generator_counters_present": bool(rows),
        "requests_counted": req if rows else None,
        "api429_total": api429, "webhookInbound429": int(last.get("webhookInbound429") or 0) if rows else None,
        "http5xx": int(last.get("http5xx") or 0) if rows else None,
        "networkErrors": int(last.get("networkErrors") or 0) if rows else None,
        "api429_by_source": {
            "session_exchange_limit(rider/driver_session)": in_counter,
            "accept": acc429,
            "unattributed_other_routes": None if api429 is None else api429 - in_counter - acc429,
        },
        "outside_P8_counter": {"session_exchange_limit(driver_onboarding)": steps.get("driver_onboarding", 0)},
        "telegram_outbound_mock_429": tg,
        "gateway_5xx_by_route": dict(gw5.most_common()),
    }
    return out


def wave(d: Path, limit: int, session_limit: int) -> dict:
    w = b25.wave(d, limit)
    w["all_gates"] = all_gates(d)
    w.update(extras(d, session_limit))
    return w


def validity(d: Path) -> dict:
    q = d / "qual"
    vv = {}
    for k in ("preflight", "inflight"):
        j = read_json(q / f"{k}.json")
        vv[k] = (j or {}).get("verdict", "MISSING")
    return vv


def is_valid(w: dict) -> bool:
    return (all(v == "VALID" for v in w["validity"].values()) and "error" not in w
            and w["all_gates"]["verdict"] is not None)


def condition_ok(w: dict, session_limit: int) -> bool:
    se = w.get("session_exchange") or {}
    lc = se.get("limit_check") or {}
    return (lc.get("ok") is True and lc.get("effective_limit") == session_limit
            and lc.get("gateway_comm") == "bun" and se.get("rejected_429") == 0)


def load_series(out_root: Path, runs: list[str], session_limit: int) -> dict:
    waves = {}
    for r in runs:
        side = "R" if "-R" in r else "C"
        w = wave(out_root / "raw" / r, 50 if side == "R" else 100, session_limit)
        w["side"] = side
        w["validity"] = validity(out_root / "raw" / r)
        waves[r] = w
    return waves


def decide(out_root: Path, session_limit: int, runs: list[str]) -> dict:
    waves = load_series(out_root, runs, session_limit)
    res: dict = {"session_limit": session_limit, "series": runs,
                 "validity": {k: w["validity"] for k, w in waves.items()},
                 "condition": {k: condition_ok(w, session_limit) for k, w in waves.items()}}
    if len(runs) != SERIES_SIZE or not all(is_valid(w) for w in waves.values()):
        res["decision"] = "INCONCLUSIVE"
        res["why"] = "سلسلةٌ غيرُ مكتملةِ الصلاحيّة (تُعادُ كاملةً بالقاعدةِ المسجَّلة، لا انتقاء)"
        return {"waves": waves, "result": res}
    if not all(res["condition"].values()):
        res["decision"] = "INVALID-CONDITION"
        res["why"] = "شرطُ القياسِ لم يتحقّق: حدُّ الجلسةِ الفعليُّ ≠ المعلن أو 429 من حدِّ الجلسة"
        return {"waves": waves, "result": res}
    R = [w for w in waves.values() if w["side"] == "R"]
    C = [w for w in waves.values() if w["side"] == "C"]
    fe = lambda w: w["rates"]["first_exec_per_s"]
    p4 = lambda w: (w.get("P4") or {}).get("p95")
    qend = lambda w: w["queue"]["at_inject_end"]
    comp = lambda w: (w.get("completions") or {}).get("verified_per_s")
    agg = {}
    for name, f in (("first_exec_per_s", fe), ("exec_per_s", lambda w: w["rates"]["exec_per_s"]),
                    ("arrival_per_s", lambda w: w["rates"]["arrival_per_s"]), ("P4_p95_ms", p4),
                    ("verified_per_s", comp),
                    ("queue_at_inject_end", qend), ("passMs_p50", lambda w: w["passes"]["passMs"].get("p50")),
                    ("passMs_p95", lambda w: w["passes"]["passMs"].get("p95")),
                    ("passMs_p99", lambda w: w["passes"]["passMs"].get("p99")),
                    ("cycle_ms_p50", lambda w: w["passes"]["cycle_ms"].get("p50")),
                    ("qbfe_p95_ms", lambda w: (w.get("queue_before_first_exec_ms") or {}).get("p95")),
                    ("session_window_max", lambda w: w["session_exchange"]["redis_window"]["max"])):
        agg[name] = {"R": stat([f(w) for w in R]), "C": stat([f(w) for w in C])}
    res["aggregate"] = agg
    A = lambda k, side, f: agg[k][side][f]
    crit = {}
    crit["a_all_C_gates_pass"] = all(w["all_gates"]["verdict"] == "PASS" for w in C)
    crit["b_P4_each_C_le_30s"] = all(p4(w) is not None and p4(w) <= P4_LIMIT_MS for w in C)
    r_spread = (None if A("P4_p95_ms", "R", "max") is None else A("P4_p95_ms", "R", "max") - A("P4_p95_ms", "R", "min"))
    gain = (None if A("P4_p95_ms", "R", "min") is None or A("P4_p95_ms", "C", "max") is None
            else A("P4_p95_ms", "R", "min") - A("P4_p95_ms", "C", "max"))
    crit["b2_P4_gain_beyond_R_jitter"] = agg["P4_p95_ms"]["C"]["missing"] == 0 and lt(r_spread, gain)
    crit["c_service_separated"] = (
        agg["first_exec_per_s"]["C"]["missing"] == 0
        and lt(A("first_exec_per_s", "R", "max"), A("first_exec_per_s", "C", "min"))
        and A("first_exec_per_s", "C", "median") is not None
        and A("first_exec_per_s", "C", "median") >= A("first_exec_per_s", "R", "median") * (1 + SERVICE_MIN_GAIN))
    rq = A("queue_at_inject_end", "R", "median")
    crit["d_queue_recedes"] = rq is not None and all(
        (qend(w) is not None and qend(w) <= QUEUE_END_MAX_SHARE * rq)
        and (w["queue"]["slope_second_half_per_s"] is not None and w["queue"]["slope_second_half_per_s"] <= QUEUE_SLOPE_MAX)
        and (w["queue"]["drain_to_zero_s"] is not None and w["queue"]["drain_to_zero_s"] <= DRAIN_MAX_S)
        for w in C)
    crit["e_completions_separated"] = (
        agg["verified_per_s"]["C"]["missing"] == 0 and agg["verified_per_s"]["R"]["missing"] == 0
        and lt(A("verified_per_s", "R", "max"), A("verified_per_s", "C", "min"))
        and A("verified_per_s", "C", "median") >= A("verified_per_s", "R", "median") * (1 + COMPLETIONS_MIN_GAIN))
    res["criteria"] = crit
    res["decision"] = "POSITIVE" if all(crit.values()) else "FAIL"
    return {"waves": waves, "result": res}


def smoke(out_root: Path, run: str, session_limit: int) -> dict:
    w = wave(out_root / "raw" / run, 100, session_limit)
    se = w.get("session_exchange") or {}
    lc = se.get("limit_check") or {}
    checks = {
        "effective_limit_eq_declared": lc.get("ok") is True and lc.get("effective_limit") == session_limit,
        "gateway_process_is_bun": lc.get("gateway_comm") == "bun",
        "no_session_exchange_429": se.get("rejected_429") == 0,
        "redis_window_sampled": (se.get("redis_window") or {}).get("samples", 0) > 0
        and (se.get("redis_window") or {}).get("errors", 1) == 0,
    }
    info = {"redis_window_max": (se.get("redis_window") or {}).get("max"),
            "exceeded_old_6000": ((se.get("redis_window") or {}).get("max") or 0) > 6000,
            "errors": w.get("errors"), "gates": w["all_gates"], "validity": validity(out_root / "raw" / run)}
    return {"checks": checks, "ok": all(checks.values()), "info": info}


def main() -> int:
    a = sys.argv
    if len(a) >= 5 and a[1] == "wave":
        print(json.dumps(wave(Path(a[2]), int(a[3]), int(a[4])), ensure_ascii=False, indent=1))
        return 0
    if len(a) >= 4 and a[1] == "validity":
        root = Path(a[2])
        vv = {r: validity(root / "raw" / r) for r in a[3:]}
        ok = len(a[3:]) == SERIES_SIZE and all(all(v == "VALID" for v in x.values()) for x in vv.values())
        print(json.dumps(vv, ensure_ascii=False), file=sys.stderr)
        print("ALL_VALID" if ok else "NOT_ALL_VALID")
        return 0
    if len(a) >= 5 and a[1] == "smoke":
        r = smoke(Path(a[2]), a[3], int(a[4]))
        print(json.dumps(r, ensure_ascii=False, indent=1))
        print("SMOKE_OK" if r["ok"] else "SMOKE_FAIL", file=sys.stderr)
        return 0 if r["ok"] else 3
    if len(a) >= 5 and a[1] == "decide":
        print(json.dumps(decide(Path(a[2]), int(a[3]), a[4:]), ensure_ascii=False, indent=1))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
