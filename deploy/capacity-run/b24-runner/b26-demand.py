#!/usr/bin/env python3
"""LOAD-01 · الدفعة 26 — حسابُ قيمةِ SESSION_EXCHANGE_PER_MINUTE لمقعدِ السعةِ من أدلّةِ الدفعة 25.

يُشغَّلُ ويُثبَّتُ مخرَجُه قبلَ أوّلِ موجة. لا يقرأُ عاصفةَ 429 بوصفِها طلبًا: الطلبُ يُستخرَجُ
من موجاتِ R (لا 429 فيها) ومن نافذةِ C النظيفةِ قبلَ أوّلِ رفض، والحدُّ الأعلى من الشيفرة.

الاستعمال: b26-demand.py <B25_RAW_GH_DIR>   → JSON (stdout)

التعريفات:
- مبادلاتُ الجلسةِ المعروضة = مجموعُ `n` لمسارِ POST /v1/session/telegram في أثرِ البوابة
  (load-trace، عيّنةٌ كلَّ 5s، يُعدُّ كلُّ طلبٍ بأيِّ حالة).
- المرفوضةُ بحدِّ الجلسة = أحداثُ المولّدِ التي سبُبها 429 في خطوةِ الجلسة (تسجيلُ السائق
  `steps.session=http_429`، أو `rider_session`/`driver_session` بـ HTTP 429). كلُّ حدثٍ = نداءٌ
  واحدٌ مرفوض (لا إعادةَ داخلَ المبادلة).
- المقبولة = المعروضة − المرفوضة (الحدُّ لا يضيفُ المرفوضَ إلى النافذةِ أصلًا: ZADD عندَ القبولِ فقط).
- النافذةُ المتحرّكة 60s = مجموعُ 12 عيّنةً متتاليةً من 5s.
- النافذةُ النظيفةُ لـ C = من بدءِ الحقنِ حتى أوّلِ 429 مقرّبًا لأسفلِ 5s.
"""
from __future__ import annotations

import datetime
import gzip
import json
import math
import statistics
import sys
from pathlib import Path

ROUTE = "POST /v1/session/telegram"
CONC = 750
# من الشيفرة (المرشّح 3d4dcbd0 والمرجع 9880f650) — لا من القياس:
IMMEDIATE_LIMIT = {"R": 50, "C": 100}     # apps/gateway/src/container.ts IMMEDIATE_REDISPATCH_LIMIT
IMMEDIATE_DEBOUNCE_S = 2.0                # IMMEDIATE_REDISPATCH_DEBOUNCE_MS = 2_000 (مانعُ تداخلٍ لكلِّ مدينة)
PERIODIC_LIMIT, PERIODIC_EVERY_S = 50, 20  # apps/workers/src/container.ts REDISPATCH_LIMIT · JOB_INTERVALS.redispatchSearching
SESSIONS_PER_SCENARIO = 3                 # miniapp-load.ts: تسجيلُ السائقِ (1) + الراكب (1) + السائق (1، لا ذاكرةَ من التسجيل)
MARGIN = 2.0                              # الهامشُ المعلن (مبرَّرٌ في PLAN-b26.md §1)
ROUND_TO = 1000
PARSER_MAX = 100_000                      # policy.ts: ما فوقه يرجعُ صامتًا إلى 30


def ts(s: str) -> float:
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000


def jl(p: Path):
    with gzip.open(p, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def is_session_429(e: dict) -> bool:
    if e.get("event") == "driver.onboarding_failed":
        return (e.get("steps") or {}).get("session") == "http_429"
    if e.get("event") == "scenario.outcome":
        r = str(e.get("reason") or "")
        return ("rider_session" in r or "driver_session" in r) and "429" in r
    return False


def wave(d: Path) -> dict:
    ev = list(jl(d / "miniapp-load-events.jsonl.gz"))
    t0 = ts(next(e["t"] for e in ev if e.get("event") == "phase.start"))
    t_end = ts(next(e["t"] for e in ev if e.get("event") == "phase.drain_start"))
    outs = [e for e in ev if e.get("event") == "scenario.outcome"]
    rej = sorted(ts(e["t"]) for e in ev if is_session_429(e))
    other429 = sum(1 for e in outs if "429" in str(e.get("reason") or "") and not is_session_429(e))
    first = (rej[0] - t0) / 1000 if rej else None
    tr = sorted((x["at"], x["n"]) for x in jl(d / "load-trace.jsonl.gz")
                if x.get("k") == "http" and x.get("route") == ROUTE and "at" in x)
    offered = sum(n for _, n in tr)
    # المرفوضُ في كلِّ عيّنة: أحداثُ 429 بين العيّنةِ السابقةِ وهذه
    acc_bins, prev, j = [], 0.0, 0
    for at, n in tr:
        r = 0
        while j < len(rej) and rej[j] <= at:
            if rej[j] > prev:
                r += 1
            j += 1
        acc_bins.append(max(n - r, 0))
        prev = at
    off_bins = [n for _, n in tr]

    def max60(b):
        return max(sum(b[i:i + 12]) for i in range(max(1, len(b) - 11)))

    clean_end = t_end if first is None else t0 + math.floor(first / 5) * 5000
    clean = [(at, n) for at, n in tr if at <= clean_end]
    clean_s = (clean_end - t0) / 1000
    # النافذةُ المتحرّكة 60s للمقبولِ داخلَ النافذةِ النظيفةِ فقط (لا يدخلُها أثرُ العاصفة)
    cb = [n for at, n in tr if at <= clean_end]
    out = {
        "scenarios": len(outs), "verified": sum(1 for e in outs if e.get("kind") == "verified"),
        "session_offered": offered, "session_rejected_429": len(rej),
        "session_accepted": offered - len(rej),
        "calls_per_scenario": round(offered / len(outs), 3) if outs else None,
        "first_session_429_s": None if first is None else round(first, 1),
        "other_429_outcomes": other429,
        "startup_10s_offered": sum(n for at, n in tr if at <= t0 + 10_000),
        "max_sliding60_offered_bins": max60(off_bins),
        "max_sliding60_accepted_bins": max60(acc_bins),
        "clean_window_s": round(clean_s, 1),
        "clean_offered_per_s": round(sum(n for _, n in clean) / clean_s, 1) if clean_s > 0 else None,
        "clean_max_sliding60_offered": max60(cb) if cb else None,
        "clean_completions_per_s": round(sum(1 for e in outs if ts(e["t"]) <= clean_end) / clean_s, 2) if clean_s else None,
        "clean_non_verified_outcomes": sum(1 for e in outs if ts(e["t"]) <= clean_end and e.get("kind") != "verified"),
    }
    if first is None:  # موجةٌ بلا رفض: الحالُ المستقرّةُ من 60s حتى نهايةِ الحقن
        a = t0 + 60_000
        sw = [n for at, n in tr if a < at <= t_end]
        lam = sum(1 for e in outs if a <= ts(e["t"]) < t_end) / ((t_end - a) / 1000)
        out["steady_session_per_s"] = round(sum(sw) / (5 * len(sw)), 1) if sw else None
        out["steady_completions_per_s"] = round(lam, 2)
        out["steady_sessions_over_3lambda"] = round(out["steady_session_per_s"] / (3 * lam), 3) if lam else None
    return out


def bound(side: str) -> dict:
    mu = IMMEDIATE_LIMIT[side] / IMMEDIATE_DEBOUNCE_S + PERIODIC_LIMIT / PERIODIC_EVERY_S
    startup = SESSIONS_PER_SCENARIO * CONC
    d60 = startup + SESSIONS_PER_SCENARIO * mu * 60
    return {"first_exec_capacity_per_s": mu, "startup_cohort_calls": startup, "D60_upper_bound": round(d60)}


def main() -> int:
    root = Path(sys.argv[1])
    waves = {n: wave(root / f"b25-s1-{n}-750") for n in ("R1", "C1", "C2", "R2", "C3", "R3", "R4", "C4")}
    R = [w for k, w in waves.items() if k[0] == "R"]
    C = [w for k, w in waves.items() if k[0] == "C"]
    bR, bC = bound("R"), bound("C")
    raw_v = MARGIN * bC["D60_upper_bound"]
    value = int(math.ceil(raw_v / ROUND_TO) * ROUND_TO)
    checks = {
        "R_has_no_session_429": all(w["session_rejected_429"] == 0 for w in R),
        "R_calls_per_scenario_eq_3": all(w["calls_per_scenario"] == 3.0 for w in R),
        "R_observed_max60_le_R_bound": max(w["max_sliding60_offered_bins"] for w in R) <= bR["D60_upper_bound"],
        "R_steady_completions_le_R_capacity": max(w["steady_completions_per_s"] for w in R) <= bR["first_exec_capacity_per_s"],
        "C_clean_completions_le_C_capacity": max(w["clean_completions_per_s"] for w in C) <= bC["first_exec_capacity_per_s"],
        "C_clean_max60_le_C_bound": max(w["clean_max_sliding60_offered"] for w in C) <= bC["D60_upper_bound"],
        "value_gt_old_6000": value > 6000,
        "value_le_parser_max": value <= PARSER_MAX,
    }
    res = {
        "inputs": "b25 raw/batch25/gh (PR #606 @ 4e0db400; SHA256SUMS هناك)",
        "constants_from_code": {"IMMEDIATE_LIMIT": IMMEDIATE_LIMIT, "IMMEDIATE_DEBOUNCE_S": IMMEDIATE_DEBOUNCE_S,
                                "PERIODIC_LIMIT": PERIODIC_LIMIT, "PERIODIC_EVERY_S": PERIODIC_EVERY_S,
                                "SESSIONS_PER_SCENARIO": SESSIONS_PER_SCENARIO, "CONC": CONC, "PARSER_MAX": PARSER_MAX},
        "waves_b25": waves,
        "summary": {
            "R_max_sliding60_offered": [min(w["max_sliding60_offered_bins"] for w in R), max(w["max_sliding60_offered_bins"] for w in R)],
            "R_steady_session_per_s": [min(w["steady_session_per_s"] for w in R), max(w["steady_session_per_s"] for w in R)],
            "R_steady_completions_per_s": [min(w["steady_completions_per_s"] for w in R), max(w["steady_completions_per_s"] for w in R)],
            "C_first_429_s": [min(w["first_session_429_s"] for w in C), max(w["first_session_429_s"] for w in C)],
            "C_clean_completions_per_s": [min(w["clean_completions_per_s"] for w in C), max(w["clean_completions_per_s"] for w in C)],
            "C_clean_offered_per_s": [min(w["clean_offered_per_s"] for w in C), max(w["clean_offered_per_s"] for w in C)],
            "C_clean_max_sliding60_offered": [min(w["clean_max_sliding60_offered"] for w in C), max(w["clean_max_sliding60_offered"] for w in C)],
        },
        "bound_R": bR, "bound_C": bC,
        "margin": MARGIN, "value_raw": raw_v, "SESSION_EXCHANGE_PER_MINUTE": value,
        "expected_max_utilisation": {"R": round(bR["D60_upper_bound"] / value, 3), "C": round(bC["D60_upper_bound"] / value, 3)},
        "checks": checks, "ok": all(checks.values()),
    }
    print(json.dumps(res, ensure_ascii=False, indent=1))
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
