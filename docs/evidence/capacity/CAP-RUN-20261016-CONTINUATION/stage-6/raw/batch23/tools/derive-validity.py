#!/usr/bin/env python3
"""الدفعة 23 — اشتقاقُ validity.json لمقعدِ GitHub من مرجعِ خمولِه، بقاعدةِ B12-V2 نفسِها حرفاً.

derive-validity.py <idle-dir> <out.json>
- سرعةُ المسبارَين ≤ round(وسيطُ الخمول × 1.10) (هي القاعدةُ التي أعطت 447/381 على المقعدِ الأصليّ).
- حدودُ السرقةِ والأشقّاءِ والأجنبيِّ وiowait والكتلِ والخنقِ: قيمُ B12-V2 المطلقةُ نفسُها بلا تغيير.
- لا حصّةَ CPU على شريحةِ المقعد: cpu.max يجبُ أن يبدأ بـ«max»، وإلا رمزُ خروجٍ 4 (INVALID_ENV للمقعدِ كلِّه).
يُكتَبُ مرّةً واحدةً قبلَ أوّلِ موجة ولا يُعدَّلُ بعدَها.
"""
import json, statistics as st, sys

IDLE, OUT = sys.argv[1], sys.argv[2]
rows = [json.loads(l) for l in open(f"{IDLE}/host-idle.jsonl")]
meta = next(r for r in rows if r.get("k") == "meta")
H = [r for r in rows if r.get("k") == "host"]
sp = [json.loads(l)["max_wall_ms"] for l in open(f"{IDLE}/speed-probe-idle.jsonl") if l.strip()]
pg = [json.loads(l)["pg_probe_ms"] for l in open(f"{IDLE}/pg-probe-idle.jsonl") if l.strip()]
mad = lambda v: round(st.median([abs(x - st.median(v)) for x in v]), 2)
steal = [r["cpu"]["steal"] for r in H]
sib = [(r["cg_cpu_pct_of_1core"]["system.slice"] or 0) + (r["cg_cpu_pct_of_1core"]["init.scope"] or 0) for r in H]
fr = [r["foreign_cpu_pct_of_1core_5s"] for r in H if "foreign_cpu_pct_of_1core_5s" in r]
cpu_max = meta.get("seat_cpu_max") or ""
ref = {
    "source": f"{IDLE} (البوّابةُ مطفأة، PG/Redis/الوسيط/المحاكي قائمةٌ خاملة)",
    "ncpu": meta.get("ncpu"),
    "seat_cgroup": meta.get("seat_cgroup"),
    "speed_probe_median_ms": round(st.median(sp), 2), "speed_probe_mad_ms": mad(sp),
    "pg_probe_median_ms": round(st.median(pg), 2), "pg_probe_mad_ms": mad(pg),
    "idle_steal_mean_pct": round(st.mean(steal), 2),
    "idle_steal_p99_pct": round(sorted(steal)[int(0.99 * (len(steal) - 1))], 2),
    "idle_system_slice_mean_pct_1core": round(st.mean(sib), 2),
    "idle_foreign_mean_pct_1core": round(st.mean(fr), 2) if fr else None,
    "idle_iowait_mean_pct": round(st.mean(r["cpu"]["iowait"] for r in H), 2),
}
spd, pgm = round(ref["speed_probe_median_ms"] * 1.10), round(ref["pg_probe_median_ms"] * 1.10)
V = {
    "version": "B23-RUNNER-V1",
    "pinned_before_any_new_wave": True,
    "reference": ref,
    "preflight": {"window_s": 60, "speed_probe_median_max_ms": spd, "pg_probe_median_max_ms": pgm,
                  "steal_mean_max_pct": 1.0, "steal_1s_max_pct": 10.0, "siblings_mean_max_pct_1core": 2.0,
                  "foreign_mean_max_pct_1core": 3.0, "iowait_mean_max_pct": 1.0, "procs_blocked_max": 1,
                  "throttled_max": 0, "seat_cpu_max_required": cpu_max,
                  "no_leftover_processes": ["apps/gateway/src/index.ts", "miniapp-load", "capacity-run/load/"]},
    "inflight": {"steal_mean_max_pct": 2.0, "steal_10s_rolling_max_pct": 10.0, "siblings_mean_max_pct_1core": 5.0,
                 "foreign_mean_max_pct_1core": 5.0, "iowait_mean_max_pct": 2.0, "throttled_max": 0,
                 "post_speed_probe_median_max_ms": spd, "post_pg_probe_median_max_ms": pgm},
    "rules": [
        "مشتقٌّ آليّاً بقاعدةِ B12-V2 (المرجع × 1.10 للمسبارَين، والحدودُ المطلقةُ الأخرى حرفاً) من مرجعِ خمولِ هذا المقعدِ قبلَ أوّلِ موجة.",
        "إخفاقُ الفحصِ المسبقِ ⇒ لا حقن؛ وإخفاقُ شرطٍ أثناءَ الموجةِ أو بعدَها ⇒ INVALID_ENV تُحفَظُ وتُستبعَدُ من المتوسّطاتِ والاستنتاجات.",
        "حدودُ القبولِ الوظيفيّةُ والأدائيّةُ (ACCEPTANCE-PROTOCOL.md) لا تتغيّر.",
    ],
    "derived_from": "B12-V2 (/srv/ceezr-cap-20261016/bin/validity.json على المقعدِ ذي النواتَين)",
}
json.dump(V, open(OUT, "w"), ensure_ascii=False, indent=1)
print(json.dumps({"speed_max": spd, "pg_max": pgm, "cpu_max": cpu_max, "ncpu": ref["ncpu"]}))
sys.exit(0 if cpu_max.startswith("max") else 4)
