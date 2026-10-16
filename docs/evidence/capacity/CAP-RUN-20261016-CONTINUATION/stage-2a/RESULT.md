# المرحلة 2أ — إصلاح أداة الحقن pg_restart (مكتملة)

**التاريخ:** 2026-10-16 · **الفرع:** work/miniapp-capacity-20261016

## المشكلة
فعل `pg_restart` في `deploy/capacity-run/monitor/chaos.ts` كان يمرر `-o "-p 55432 -k $B/sock ..."` —
مجلد السوكيت `$B/sock` غير موجود (الفعلي `$B/pg-sock` من postgresql.conf الذي يكتبه setup-env).
النتيجة: `pg_ctl restart` يوقف PG بنجاح ثم يفشل إقلاعه **بصمت** ويبقى ميتًا — وهو ما قتل
جولة SOAK الأولى عند الدقيقة 38 ولم يُعاد PG إلا يدويًا.

## السبب الجذري (دليله)
- `setup-env-20261016.sh` يشغّل: `pg_ctl -D $B/pg -l $B/pg.log start` بلا `-o` (الإعداد من postgresql.conf)
- `postgresql.conf` يحوي `unix_socket_directories = '$B/pg-sock'` — لا `$B/sock`

## التغيير
- `chaos.ts`: حذف `-o` كاملًا (الإعداد من الـconf كما في setup-env)، وإضافة
  `pg_isready` مستقل بعد كل إعادة تشغيل يُسجَّل في `rec.pgReadyCheck`، وعند فشله
  يُسجَّل `rec.toolFailure` — الأداة تفشل بصوت عالٍ لا بصمت.
- اختبار انحدار: `tests/unit/chaos-pg-restart-contract.test.ts` (4/4) يمنع عودة `-o`.

## الاختبار المستقل للأداة (المعيار: بدء/إيقاف/إعادة PG ثم تحقق الجاهزية)
- خطة مفردة `[{"at_min":0,"action":"pg_restart"}]` على البيئة المعزولة (r-2a-tooltest)
- النتيجة (`fault-injection.json` المرفق):
  - `result: server stopped → server started` (كود 0)
  - `pgReadyCheck: accepting connections` (كود 0)
  - `action_ms: 779` — إعادة التشغيل الكاملة
  - `ready_after_ms: 109` — البوابة استعادت /ready خلال 109ms **ذاتيًا**
  - `recovered: True` — بلا أي تدخل يدوي

## ملاحظة مهمة للمرحلة 2ب
هذا الاختبار أثبت عرضًا أن البوابة تتعافى ذاتيًا (109ms) من إيقاف/إعادة تشغيل PG **الصحيح**
— عكس الجولة الأولى التي فشلت لأن الأداة قتلت PG دون إعادة. المرحلة 2ب تبني على هذا:
تجربة معزولة كاملة مع دورة أعمال بعد التعافي، وتمييزها عن قتل backends وحده.

## الحكم
**المرحلة 2أ: مكتملة** — الأداة تُصلح نفسها وتتحقق من جاهزيتها، والدليل مرفق.
