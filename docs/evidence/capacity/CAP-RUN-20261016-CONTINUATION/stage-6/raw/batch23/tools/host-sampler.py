#!/usr/bin/env python3
"""عيّناتُ المضيفِ كلَّ ثانية (الدفعةُ الثانيةَ عشرة — تأهيلُ المقعد).

لكلِّ سطر: round، t (ثواني يونكس بالمللي)، ومن /proc/stat فروقُ كلِّ نواةٍ وكلِّ المعالجِ بالنسبة:
user/nice/system/idle/iowait/irq/softirq/steal، و procs_running/procs_blocked، و/proc/loadavg؛
ومن cgroup v2: فرقُ usage_usec لـ system.slice و space.slice و init.scope و code-mode، و
nr_throttled/throttled_usec لمسارِ عمليّاتِ المقعد، و cpu.max؛ و/proc/pressure/cpu إن وُجد (وإلّا null
صراحةً)؛ والقرصُ من /proc/diskstats (قطاعاتُ القراءةِ والكتابة و io_ticks)، والشبكةُ من /proc/net/dev
(بايتاتُ lo وغيرِها)؛ وكلَّ 5ث CPU العمليّاتِ «الأجنبيّة» (ليست من المقعد) بأعلاها.
"""
import json, os, sys, time

out = sys.argv[1]
dur = float(sys.argv[2]) if len(sys.argv) > 2 else 600
rnd = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("ROUND", "?")
HZ = os.sysconf("SC_CLK_TCK")
CG = "/sys/fs/cgroup"
# B23: مقعدُ GitHub يضعُ المقعدَ في شريحةٍ مستقلّةٍ (ceezrseat.slice)؛ الافتراضيُّ هو المقعدُ الأصليُّ حرفاً.
SIBS = os.environ.get("CAP_SIBS", "system.slice space.slice init.scope code-mode").split()
SEAT_CG = os.environ.get("CAP_SEAT_CG", "space.slice/space-workloads.service/workloads")
FIELDS = ["user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal"]
SEAT_PAT = ("postgres", "redis-server", "shim.ts", "apps/gateway", "apps/workers", "telegram-mock",
            "miniapp-load", "capacity-run/load", "res-sampler", "host-sampler", "pg-activity", "psql",
            "wave-full", "run-wave", "fresh-db", "/nsx", "speed-probe")


def rd(p):
    try:
        with open(p) as f:
            return f.read()
    except OSError:
        return None


def stat():
    cpus, extra = {}, {}
    for line in rd("/proc/stat").splitlines():
        p = line.split()
        if p[0].startswith("cpu"):
            cpus[p[0]] = [int(x) for x in p[1:9]]
        elif p[0] in ("procs_running", "procs_blocked", "ctxt"):
            extra[p[0]] = int(p[1])
    return cpus, extra


def cg_usage():
    r = {}
    for s in SIBS:
        t = rd(f"{CG}/{s}/cpu.stat")
        r[s] = int(t.split("usage_usec ")[1].split()[0]) if t else None
    t = rd(f"{CG}/{SEAT_CG}/cpu.stat") or ""
    kv = dict(l.split() for l in t.splitlines() if len(l.split()) == 2)
    r["seat_nr_throttled"] = int(kv.get("nr_throttled", 0))
    r["seat_throttled_usec"] = int(kv.get("throttled_usec", 0))
    return r


def disk():
    rs = ws = io = 0
    for line in (rd("/proc/diskstats") or "").splitlines():
        p = line.split()
        if len(p) > 13 and not p[2].startswith(("loop", "ram")) and not p[2][-1].isdigit():
            rs += int(p[5]); ws += int(p[9]); io += int(p[12])
    return rs, ws, io


def net():
    lo = other = 0
    for line in (rd("/proc/net/dev") or "").splitlines()[2:]:
        name, rest = line.split(":", 1)
        v = rest.split(); b = int(v[0]) + int(v[8])
        if name.strip() == "lo": lo += b
        else: other += b
    return lo, other


def procs():
    m = {}
    for pid in os.listdir("/proc"):
        if not pid.isdigit(): continue
        s = rd(f"/proc/{pid}/stat")
        c = rd(f"/proc/{pid}/cmdline")
        if not s or c is None: continue
        f = s[s.rfind(")") + 2:].split()
        cmd = c.replace("\0", " ").strip() or s[s.find("(") + 1:s.rfind(")")]
        m[pid] = (int(f[11]) + int(f[12]), cmd)
    return m


def seat(cmd):
    return any(p in cmd for p in SEAT_PAT)


cpu_max = (rd(f"{CG}/{SEAT_CG}/cpu.max") or "").strip()
t0 = time.time(); c0, e0 = stat(); g0 = cg_usage(); d0 = disk(); n0 = net(); p0 = procs(); pt = t0
with open(out, "a") as fo:
    fo.write(json.dumps({"k": "meta", "round": rnd, "t": round(t0 * 1000), "hz": HZ, "ncpu": os.cpu_count(),
                         "seat_cgroup": SEAT_CG, "seat_cpu_max": cpu_max,
                         "psi_cpu_available": rd("/proc/pressure/cpu") is not None}) + "\n")
    i = 0
    while time.time() - t0 < dur:
        time.sleep(1.0); i += 1
        now = time.time(); c1, e1 = stat(); g1 = cg_usage(); d1 = disk(); n1 = net()
        row = {"k": "host", "round": rnd, "t": round(now * 1000)}
        for cpu, v in c1.items():
            dv = [b - a for a, b in zip(c0[cpu], v)]; tot = sum(dv) or 1
            row[cpu] = {k: round(100 * x / tot, 2) for k, x in zip(FIELDS, dv)}
        row["procs_running"] = e1["procs_running"]; row["procs_blocked"] = e1["procs_blocked"]
        row["ctxt_per_s"] = e1["ctxt"] - e0["ctxt"]
        row["loadavg"] = (rd("/proc/loadavg") or "").split()[:3]
        wall_us = (now - pt) * 1e6
        row["cg_cpu_pct_of_1core"] = {s: (None if g1[s] is None else round(100 * (g1[s] - g0[s]) / wall_us, 1)) for s in SIBS}
        row["seat_throttled_delta"] = g1["seat_nr_throttled"] - g0["seat_nr_throttled"]
        row["seat_throttled_usec_delta"] = g1["seat_throttled_usec"] - g0["seat_throttled_usec"]
        psi = rd("/proc/pressure/cpu"); row["psi_cpu"] = psi.strip() if psi else None
        row["disk"] = {"read_kb_s": (d1[0] - d0[0]) // 2, "write_kb_s": (d1[1] - d0[1]) // 2, "io_ms": d1[2] - d0[2]}
        row["net_bytes_s"] = {"lo": n1[0] - n0[0], "other": n1[1] - n0[1]}
        if i % 5 == 0:
            p1 = procs(); w = now - (row.get("_pt") or (now - 5))
            fr = []
            for pid, (ticks, cmd) in p1.items():
                if seat(cmd): continue
                d = ticks - p0.get(pid, (ticks, ""))[0] if pid in p0 else ticks
                if d > 0: fr.append((d, cmd[:80]))
            fr.sort(reverse=True)
            tot = sum(d for d, _ in fr)
            row["foreign_cpu_pct_of_1core_5s"] = round(100 * tot / HZ / 5, 2)
            row["foreign_top"] = [[round(100 * d / HZ / 5, 2), c] for d, c in fr[:5]]
            p0 = p1
        fo.write(json.dumps(row) + "\n"); fo.flush()
        c0, e0, g0, d0, n0, pt = c1, e1, g1, d1, n1, now
