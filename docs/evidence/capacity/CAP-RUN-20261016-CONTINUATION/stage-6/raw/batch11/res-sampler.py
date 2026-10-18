#!/usr/bin/env python3
"""عيّناتُ موارد كل 5ث (الإصدار 2 — الدفعة 11).

- نسبةُ المعالج لكلِّ صنفِ عمليةٍ من فرقِ /proc (utime+stime)، والحِملُ والذاكرة.
- أصنافٌ: postgres، redis، redis_shim (وسيطُ REST المحلّي)، gateway، workers، mock، generator.
- PostgreSQL مفصّلٌ حسبَ application_name للخادمِ الخلفيّ (من pg_stat_activity عبرَ psql داخلَ netns):
  pg_by_app = {"ceezr:gatewayRequest": cpu_pct, ...}؛ وما لا اسمَ له "other"، والعمليّاتُ المساعدةُ "pg_aux".
- كلُّ سطرٍ يحملُ cum_cpu_s: ثواني CPU التراكميّة لكلِّ صنفٍ منذُ بدءِ العيّنات (لقسمتها على السيناريوهات).
"""
import json, os, subprocess, sys, time

out = sys.argv[1]
dur = int(sys.argv[2]) if len(sys.argv) > 2 else 900
HZ = os.sysconf("SC_CLK_TCK")
NSX = "/home/user/cap-seat/bin/nsx"


def classify(cmd):
    if cmd.startswith("postgres") or "/postgres " in cmd or "bin/postgres" in cmd: return "postgres"
    if "redis-server" in cmd: return "redis"
    if "shim.ts" in cmd: return "redis_shim"
    if "apps/gateway" in cmd: return "gateway"
    if "apps/workers" in cmd: return "workers"
    if "telegram-mock" in cmd: return "mock"
    if "miniapp-load" in cmd or "load/" in cmd: return "generator"
    return None


def app_names():
    try:
        r = subprocess.run([NSX, "bash", "-c", "psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -Atc \"select pid||'|'||coalesce(nullif(application_name,''),'other') from pg_stat_activity where backend_type='client backend'\""],
                           capture_output=True, text=True, timeout=4)
        m = {}
        for line in r.stdout.splitlines():
            if "|" in line:
                p, a = line.split("|", 1); m[p] = a
        return m
    except Exception:
        return {}


def snap(apps):
    res, pg = {}, {}
    for pid in os.listdir("/proc"):
        if not pid.isdigit(): continue
        try:
            cmd = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="ignore")
            c = classify(cmd)
            if c is None: continue
            st = open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()
            ticks = int(st[11]) + int(st[12])
            rss = int(st[21]) * 4096
            a = res.setdefault(c, [0, 0]); a[0] += ticks; a[1] += rss
            if c == "postgres":
                key = apps.get(pid) or ("other_client" if "127.0.0.1(" in cmd else "pg_aux")
                pg[(pid, key)] = ticks
        except Exception:
            continue
    return res, pg


apps = app_names()
prev, pgprev = snap(apps); pt = time.time(); end = pt + dur
base = {k: v[0] for k, v in prev.items()}
cum = {}
with open(out, "a") as f:
    while time.time() < end:
        time.sleep(5)
        apps = app_names()
        cur, pgcur = snap(apps); now = time.time(); dt = now - pt
        row = {"t": round(now, 1), "load1": os.getloadavg()[0]}
        for k, (ticks, rss) in cur.items():
            pticks = prev.get(k, [ticks, 0])[0]
            d = max(0, ticks - pticks)
            cum[k] = cum.get(k, 0) + d
            row[k] = {"cpu_pct": round(100 * d / HZ / dt, 1), "rss_mb": rss // 1048576}
        by_app = {}
        prevticks = {pp: v for (pp, _), v in pgprev.items()}
        for (pid, key), ticks in pgcur.items():
            # الخادمُ الجديدُ في هذه النافذةِ يُحسَبُ كلُّ ما استهلكه منذُ ولادته داخلَها تقريبًا
            p = prevticks.get(pid, 0)
            by_app[key] = by_app.get(key, 0) + max(0, ticks - p)
        row["pg_by_app"] = {k: round(100 * v / HZ / dt, 1) for k, v in by_app.items()}
        for k, v in by_app.items():
            cum["pg:" + k] = cum.get("pg:" + k, 0) + v
        row["cum_cpu_s"] = {k: round(v / HZ, 2) for k, v in cum.items()}
        f.write(json.dumps(row) + "\n"); f.flush()
        prev, pgprev, pt = cur, pgcur, now
