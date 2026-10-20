#!/usr/bin/env python3
"""الدفعة 26 — عيّناتُ نافذةِ حدِّ مبادلةِ الجلسةِ كلَّ ثانيةٍ منَ Redis مباشرةً (قراءةٌ فقط).

  rl-sampler.py <OUT.jsonl> <DURATION_S> [<LIMIT>]

الحدُّ نافذةٌ منزلقةٌ (ZSET لكلِّ مفتاح؛ يُضافُ العضوُ عندَ القبولِ فقط)، فـ
ZCOUNT key (now-60000 +inf = النداءاتُ المقبولةُ في آخرِ 60s = استهلاكُ الحدِّ الفعليّ.
المفتاحُ يحوي عنوانَ العميل؛ يُكتَبُ مستعارًا (sha256 مقتطَع) لا حرفيًّا.
عميلُ RESP صغيرٌ باتصالٍ واحدٍ دائمٍ (لا عمليةَ لكلِّ عيّنة) — كلفةٌ مهملةٌ ومتساويةٌ للجانبَين.
"""
import hashlib
import json
import socket
import sys
import time

OUT, DUR = sys.argv[1], float(sys.argv[2])
LIMIT = int(sys.argv[3]) if len(sys.argv) > 3 else None
PATTERN = b"waslah:rate:session-telegram:*"
PREFIX = "waslah:rate:session-telegram:"


class Redis:
    def __init__(self):
        self.s = socket.create_connection(("127.0.0.1", 56379), timeout=2)
        self.f = self.s.makefile("rb")

    def cmd(self, *args):
        parts = [a if isinstance(a, bytes) else str(a).encode() for a in args]
        self.s.sendall(b"*%d\r\n" % len(parts) + b"".join(b"$%d\r\n%s\r\n" % (len(p), p) for p in parts))
        return self.read()

    def read(self):
        line = self.f.readline()
        t, body = line[:1], line[1:-2]
        if t == b"+":
            return body.decode()
        if t == b"-":
            raise RuntimeError(body.decode())
        if t == b":":
            return int(body)
        if t == b"$":
            n = int(body)
            if n < 0:
                return None
            return self.f.read(n + 2)[:-2]
        if t == b"*":
            n = int(body)
            return None if n < 0 else [self.read() for _ in range(n)]
        raise RuntimeError("RESP")


def alias(key: bytes) -> str:
    addr = key.decode(errors="replace")[len(PREFIX):]
    return "addr#" + hashlib.sha256(addr.encode()).hexdigest()[:8]


end = time.time() + DUR
r = None
with open(OUT, "a", encoding="utf-8") as out:
    while time.time() < end:
        t0 = time.time()
        row = {"t": int(t0 * 1000)}
        try:
            if r is None:
                r = Redis()
            keys, cur = [], b"0"
            while True:
                cur, batch = r.cmd("SCAN", cur, "MATCH", PATTERN, "COUNT", 1000)
                keys += batch
                if cur in (b"0", "0"):
                    break
            now = int(time.time() * 1000)
            ks = []
            for k in keys:
                ks.append({"k": alias(k), "window": r.cmd("ZCOUNT", k, f"({now - 60000}", "+inf"),
                           "card": r.cmd("ZCARD", k)})
            row["keys"] = ks
            row["window_max"] = max((x["window"] for x in ks), default=0)
            if LIMIT:
                row["utilisation"] = round(row["window_max"] / LIMIT, 4)
        except Exception as e:  # noqa: BLE001 — العيّنةُ تُعلَّمُ خطأً ولا تُخترَع
            row["error"] = type(e).__name__
            r = None
        out.write(json.dumps(row) + "\n")
        out.flush()
        time.sleep(max(0.0, 1.0 - (time.time() - t0)))
