#!/usr/bin/env python3
"""عينات موارد المضيف كل ثانيتين إلى ملف JSONL (تشخيص ب24).

عينات المستخدم/الخمول تُشتق من فرق /proc/stat بين عيّنتين متتاليتين لا من
القيمة التراكمية منذ الإقلاع، فتعكس النافذةَ الفعلية لكل عيّنة.
"""
import json
import sys
import time

PREV = None


def cpu_sample():
    global PREV
    with open("/proc/stat") as f:
        parts = f.readline().split()[1:]
    vals = list(map(int, parts))
    idle_all = vals[3] + vals[4]
    total = sum(vals)
    cur = (total, idle_all)
    if PREV is None or cur[0] == PREV[0]:
        PREV = cur
        return None
    idle_pct = 100.0 * (cur[1] - PREV[1]) / max(1, cur[0] - PREV[0])
    PREV = cur
    return round(idle_pct, 2)


def sample():
    with open("/proc/loadavg") as f:
        la = f.read().split()
    with open("/proc/meminfo") as f:
        mem = {}
        for line in f:
            k, v = line.split(":")
            mem[k] = int(v.split()[0])
    psi = None
    try:
        with open("/proc/pressure/cpu") as f:
            for line in f:
                if line.startswith("some "):
                    psi = float(line.split("avg10=")[1].split()[0])
    except OSError:
        pass
    return {
        "t": time.time(),
        "load1": float(la[0]),
        "cpuIdlePctWindow": cpu_sample(),
        "memAvailableKb": mem.get("MemAvailable"),
        "psiCpuSomeAvg10": psi,
    }


def main():
    out = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 600
    with open(out, "a") as f:
        for _ in range(limit):
            f.write(json.dumps(sample()) + "\n")
            f.flush()
            time.sleep(2)


if __name__ == "__main__":
    main()
