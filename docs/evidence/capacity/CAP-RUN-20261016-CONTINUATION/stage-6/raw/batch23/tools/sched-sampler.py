#!/usr/bin/env python3
"""الدفعة 23 — عيّناتُ جدولةِ المعالج كلَّ ثانية (تشخيصٌ فقط؛ لا يدخلُ الصلاحيةَ ولا البوابات).

sched-sampler.py <out.jsonl> <seconds>
لكلِّ ثانية: ضغطُ CPU من /proc/pressure/cpu (some: نسبةُ الزمنِ الذي انتظرَت فيه مهمّةٌ واحدةٌ على الأقلّ
المعالجَ)، وprocs_running، ولكلِّ صنفٍ (gateway · postgres · generator · other_seat) فرقُ زمنِ التشغيلِ
وفرقُ زمنِ الانتظارِ في طابورِ التشغيل من /proc/<pid>/task/*/schedstat (الحقلانِ 1 و2 بالنانوثانية).
"""
import json, os, sys, time

OUT, SECS = sys.argv[1], int(sys.argv[2])


def rd(p):
    try:
        with open(p) as f:
            return f.read()
    except OSError:
        return None


def classify(cmd):
    if cmd.startswith("postgres") or "bin/postgres" in cmd: return "postgres"
    if "apps/gateway" in cmd: return "gateway"
    if "miniapp-load" in cmd or "capacity-run/load" in cmd: return "generator"
    if any(p in cmd for p in ("redis-server", "shim.ts", "telegram-mock")): return "other_seat"
    return None


def psi():
    t = rd("/proc/pressure/cpu") or ""
    for line in t.splitlines():
        if line.startswith("some"):
            return int(line.split("total=")[1])
    return None


def snap():
    acc = {}
    for pid in os.listdir("/proc"):
        if not pid.isdigit(): continue
        c = rd(f"/proc/{pid}/cmdline")
        if not c: continue
        k = classify(c.replace("\0", " ").strip())
        if k is None: continue
        try:
            tids = os.listdir(f"/proc/{pid}/task")
        except OSError:
            continue
        for tid in tids:
            s = rd(f"/proc/{pid}/task/{tid}/schedstat")
            if not s: continue
            run, wait = (int(x) for x in s.split()[:2])
            a = acc.setdefault(k, {})
            a[f"{pid}/{tid}"] = (run, wait)
    return acc


def running():
    for line in (rd("/proc/stat") or "").splitlines():
        if line.startswith("procs_running"):
            return int(line.split()[1])
    return None


with open(OUT, "a") as fo:
    fo.write(json.dumps({"k": "meta", "t": round(time.time() * 1000), "ncpu": os.cpu_count()}) + "\n")
    prev, prev_psi, prev_t = snap(), psi(), time.time()
    end = prev_t + SECS
    while time.time() < end:
        time.sleep(1)
        cur, cur_psi, t = snap(), psi(), time.time()
        dt = t - prev_t
        row = {"k": "sched", "t": round(t * 1000), "procs_running": running(),
               "psi_some_pct": round((cur_psi - prev_psi) / (dt * 1e4), 2) if cur_psi is not None and prev_psi is not None else None}
        for k, threads in cur.items():
            dr = dw = 0
            for key, (r, w) in threads.items():
                pr, pw = prev.get(k, {}).get(key, (0, 0))
                dr += max(0, r - pr); dw += max(0, w - pw)
            # بوحدةِ «نواةٍ واحدة %»: 100 = نواةٌ كاملةٌ طوالَ الثانية.
            row[k] = {"run_pct_1core": round(dr / (dt * 1e7), 1), "runq_wait_pct_1core": round(dw / (dt * 1e7), 1),
                      "threads": len(threads)}
        fo.write(json.dumps(row) + "\n"); fo.flush()
        prev, prev_psi, prev_t = cur, cur_psi, t
