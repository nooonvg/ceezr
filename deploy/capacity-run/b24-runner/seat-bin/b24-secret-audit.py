#!/usr/bin/env python3
"""ب24 — تدقيقُ الأسرارِ على ملفّاتِ الدليلِ قبلَ رفعِها من مقعدِ GitHub.

الفحصُ على كلِّ ملفٍّ في مجلّداتِ الخروجِ (وملفّاتُ gzip تُفكُّ قبلَ الفحصِ — سرٌّ
داخلَ مضغوطٍ لا يُتخطّى):
  ١. تطابقٌ حرفيٌّ معَ أيِّ قيمةٍ سرّيةٍ من أسرارِ المقعدِ (secrets.env) — على كلِّ
     الملفّاتِ بلا استثناءِ (ملفّاتُ البصماتِ لا تُستثنى من هذا الفحصِ أصلًا).
  ٢. أنماطُ أسرارٍ عامّةٍ: رؤوسُ مصادقةٍ، initData، تعييناتُ SECRET/TOKEN/PASSWORD،
     مفاتيحُ خاصة، وسلاسلُ base64 طويلة — وتُستثنى من هذا الفحصِ العامِّ وحدَهُ
     ملفّاتُ البصماتِ المعروفةُ (md5/sha256 كسجلٍّ لا كأسرارٍ).

الخروجُ: rc=0 نظيفٌ، rc=1 وجدَ ما لا يجوزُ رفعُه. **لا تُطبَعُ قيمةٌ مشتبهٌ بها
ولا مقتطعٌ منها** — اسمُ الملفِ والقاعدةِ فقط (السرُّ لا يُطبعَ أبدًا).
"""
from __future__ import annotations

import gzip
import re
import sys
from pathlib import Path

PATTERNS = [
    re.compile(rb"(?i)authorization\s*[:=]\s*bearer\s+\S{8,}"),
    re.compile(rb"(?i)init_?data\s*[:=]"),
    re.compile(rb"(?i)\b(SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY)\s*[:=]\s*\S{8,}"),
    re.compile(rb"(?i)-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(rb"\b[A-Za-z0-9+/]{40,}={0,2}\b"),
]

# الأنماطُ العامّةُ لا تُطبَّقُ على ملفّاتِ بصماتٍ معروفةٍ (md5/sha256 كسجلٍّ مشروعٍ)؛
# أمّا التطابقُ الحرفيُّ معَ الأسرارِ فيجري عليها كغيرِها بلا استثناءٍ.
HASH_EVIDENCE = re.compile(r"(^|[-_])(tpl-)?fingerprint|validity\.json$|sha256sums", re.I)

TEXT_HINTS = re.compile(rb"(?i)(postgres(?:ql)?://\S+:\S+@|redis://\S+:\S+@)")


def load_secret_values(secrets_env: Path) -> list[bytes]:
    vals: list[bytes] = []
    if not secrets_env.exists():
        return vals
    for line in secrets_env.read_text(errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key = line.split("=", 1)[0].strip()
        # مفاتيحُ تشخيصيّةٌ لا سريّةٌ: قيمُها مساراتٌ وأرقامٌ تظهرُ في الدليلِ مشروعًا.
        if re.match(r"(?i)^(DISPATCH_|DIAG_|PHONE_PROOF_WAIT_MS)", key):
            continue
        v = line.split("=", 1)[1].strip().strip('"').strip("'")
        if len(v) >= 8:
            vals.append(v.encode())
    return vals


def read_blob(path: Path) -> bytes:
    """gzip يُفكُّ قبلَ الفحصِ — فحصُ البايتاتِ المضغوطةِ ليس فحصاً للمحتوى."""
    blob = path.read_bytes()
    if path.suffix == ".gz":
        try:
            blob = gzip.decompress(blob)
        except OSError:
            pass  # ملفٌّ ليس gzip رغمَ لاحقتِه — يُفحَصُ كما هو
    return blob


def scan_file(path: Path, secrets: list[bytes]) -> list[str]:
    reasons: list[str] = []
    try:
        blob = read_blob(path)
    except OSError:
        return [f"غير قابل للقراءة"]
    for i, sv in enumerate(secrets):
        if sv and sv in blob:
            reasons.append(f"تطابقٌ حرفيٌّ معَ سرِّ المقعدِ رقمَ {i + 1}")
    if not HASH_EVIDENCE.search(path.name):
        for pat in PATTERNS:
            m = pat.search(blob)
            # بصمةُ git (SHA-1 سداسيّةٌ 40) ليست سرًّا — ولا تُطبَع.
            if m and not re.fullmatch(rb"[0-9a-fA-F]{40}", m.group(0).strip()):
                reasons.append(f"نمطٌ مشتبهٌ ({pat.pattern[:30]}…)")
                break
        if TEXT_HINTS.search(blob):
            reasons.append("عنوانُ اتصالٍ ببياناتِ اعتمادٍ مضمّنةٍ")
    return reasons


def main() -> int:
    if len(sys.argv) < 3:
        print("الاستعمال: b24-secret-audit.py SECRETS_ENV DIR [DIR…]", file=sys.stderr)
        return 2
    secrets = load_secret_values(Path(sys.argv[1]))
    bad = 0
    for d in sys.argv[2:]:
        root = Path(d)
        if not root.exists():
            continue
        for p in sorted(root.rglob("*")):
            if not p.is_file() or p.stat().st_size > 50_000_000:
                continue
            why = scan_file(p, secrets)
            if why:
                bad += 1
                print(f"FAIL {p}: {'؛ '.join(why)}")
    if bad:
        print(f"AUDIT_FAIL files={bad}")
        return 1
    print("AUDIT_CLEAN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
