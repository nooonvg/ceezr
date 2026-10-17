#!/usr/bin/env python3
"""عيّناتُ موارد كل 5ث: نسبة المعالج لكل صنف عملية (من /proc delta) + loadavg + ذاكرة."""
import json, os, sys, time

out = sys.argv[1]
dur = int(sys.argv[2]) if len(sys.argv) > 2 else 900
HZ = os.sysconf("SC_CLK_TCK")


def classify(cmd):
    if "postgres" in cmd: return "postgres"
    if "redis-server" in cmd: return "redis"
    if "apps/gateway" in cmd: return "gateway"
    if "apps/workers" in cmd: return "workers"
    if "telegram-mock" in cmd: return "mock"
    if "miniapp-load" in cmd or "load/" in cmd: return "generator"
    return None


def snap():
    res = {}
    for pid in os.listdir("/proc"):
        if not pid.isdigit(): continue
        try:
            cmd = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="ignore")
            c = classify(cmd)
            if c is None: continue
            st = open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()
            ticks = int(st[11]) + int(st[12])
            rss = int(st[21]) * 4096
            a = res.setdefault(c, [0, 0])
            a[0] += ticks; a[1] += rss
        except Exception:
            continue
    return res


prev = snap(); pt = time.time(); end = pt + dur
with open(out, "a") as f:
    while time.time() < end:
        time.sleep(5)
        cur = snap(); now = time.time(); dt = now - pt
        row = {"t": round(now, 1), "load1": os.getloadavg()[0]}
        for k, (ticks, rss) in cur.items():
            pticks = prev.get(k, [ticks, 0])[0]
            row[k] = {"cpu_pct": round(100 * (ticks - pticks) / HZ / dt, 1), "rss_mb": rss // 1048576}
        f.write(json.dumps(row) + "\n"); f.flush()
        prev, pt = cur, now
