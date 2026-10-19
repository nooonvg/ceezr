#!/usr/bin/env python3
"""مِسبارُ سرعةٍ ثابتُ العمل (الدفعةُ الثانيةَ عشرة): sha256 لـ 512MiB على كلِّ نواةٍ بالتوازي (عمليّتان).

يطبعُ JSON: زمنُ الجدارِ وزمنُ CPU لكلِّ عامل. العملُ ثابتٌ حرفيًّا، فاختلافُ الزمنِ اختلافُ المضيف
(سرعةُ النواة، السرقة، التنافس) لا الشيفرة. يُستعملُ للمرجعِ في الخمولِ وللفحصِ المسبقِ قبلَ كلِّ موجة.
"""
import hashlib, json, multiprocessing as mp, os, sys, time

BUF = b"\x5a" * (1 << 20)


def work(_):
    c0 = time.process_time(); t0 = time.perf_counter(); h = hashlib.sha256()
    for _ in range(512):
        h.update(BUF)
    return {"wall_ms": round((time.perf_counter() - t0) * 1000, 1), "cpu_ms": round((time.process_time() - c0) * 1000, 1)}


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    with mp.Pool(n) as p:
        work(0)
        t0 = time.perf_counter(); r = p.map(work, range(n)); t = (time.perf_counter() - t0) * 1000
    print(json.dumps({"t": round(time.time() * 1000), "workers": r, "max_wall_ms": max(x["wall_ms"] for x in r), "total_ms": round(t, 1)}))
