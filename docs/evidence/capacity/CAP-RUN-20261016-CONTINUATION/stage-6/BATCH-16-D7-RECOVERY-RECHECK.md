# الدفعة 16 — D7: إعادة إثبات التعافي من انقطاع PG على `main` الحالي، وإصلاح أداة كانت تنجح بلا عطل

- **التاريخ:** 2026-10-19 · **الشيفرة المختبرة:** `main` @ `e3e4b39c` (البوابة `dirty=0`) · **الأداة:** `deploy/capacity-run/load/pg-recovery.ts` بعد الإصلاح.
- **المقعد:** المقعد المعزول نفسه في الدفعة 15 (netns بلا شبكة خارجية، PG 18 و Redis محليان، تيليجرام محاكى). ليس اختبار حمل؛ لا علاقة له بحكم LOAD-01 ولا بـSOAK-01.

## 1. ما وُجد

دليل D7 السابق (`stage-2b/RESULT.md`، PASS) أُنتج قبل أن تسمّي البوابة تجمّعاتها `ceezr:<دور>` (`d8ce3607`، 2026-10-18). بعدها صارت التجربة (أ) تقتل `application_name='postgres.js'` — اسماً لم يعد يطابق شيئاً:

| التشغيل | الأداة | `backendsKilled` | حكم (أ) | حكم كلي |
|---|---|---|---|---|
| [run0](raw/batch16-d7/run0-old-tool-pg-recovery.jsonl) | قبل الإصلاح | **0** | `BACKENDS_TERMINATED_GATEWAY_SURVIVED` — **نجاح زائف** | لا يوجد |

وعيب ثانٍ: فحص `uncaughtException` يقرأ `${RUN_DIR}/evidence/gateway.log`، والبوابة تكتب سجلها في `RUN_DIR` آخر؛ فالملف الغائب كان يعطي «0 انهيار».

## 2. الإصلاح (أداة الاختبار فقط، لا شيفرة المنتج)

- القتل وفحص المعاملات العالقة يستهدفان `application_name like 'ceezr:%'`؛ وتُسجَّل خلفيات البوابة لكل دور قبل القتل وبعده.
- **قتل صفر = `NO_FAULT_INJECTED`**، لا نجاح.
- مسار السجل `GATEWAY_LOG` (يمرّره `gen-r1.sh`)؛ وسجل غير مقروء يُعلَن `readable:false` ويُسقط الحكم الكلي.
- حكم كلي جديد: `RECOVERY_PROVEN` فقط إذا نجحت (أ) بعطل فعلي، و(ب)، والسجل مقروء بلا `uncaughtException/unhandledRejection`.
- عقد `tests/unit/pg-recovery-contract.test.ts`: 10/10 على المصحح، و**2 فشل على السكربت القديم** (النمط، والقتل الصفري)؛ وحالة جديدة تتحقق أن كل `applicationName` في `container.ts` يبدأ بـ`ceezr:` فلا يتكرر الانجراف بصمت.

## 3. النتيجة على `main` @ `e3e4b39c`

| التشغيل | ما حدث | الحكم |
|---|---|---|
| [run1](raw/batch16-d7/run1-fixed-tool-log-unreadable-pg-recovery.jsonl) | الأداة المصححة، و`GATEWAY_LOG` لم يُمرَّر إلى netns | (أ) 15 خلفية مقتولة ونجت؛ (ب) نجحت؛ **الكلي `NOT_PROVEN`** لأن السجل غير مقروء — الفشل المغلق يعمل |
| [run2](raw/batch16-d7/run2-fixed-tool-pg-recovery.jsonl) | بعد تمرير `GATEWAY_LOG` عبر `gen-r1.sh` | **`RECOVERY_PROVEN`** |

تفاصيل run2:

- **(أ) قتل الخلفيات أثناء عمل جارٍ:** 15 خلفية من أدوار `ceezr:*` (لقطة قبل القتل: `gatewayRequest=5`، `workerJobs=5`، `workerLocks=4`)، `readyRightAfterKill=false` (العطل أصاب فعلاً)، البوابة بنفس PID، دورة أعمال كاملة، طلب واحد للراكب، صفر معاملات/مهام/صادر عالقة.
- **(ب) إيقاف PG كاملاً وإعادته بـ`monitor/chaos.ts`:** postmaster جديد، توقف 151ms، PG جاهز قبل البوابة، البوابة بنفس PID، دورة أعمال كاملة بعده، صفر عالق.
- **السجل:** مقروء، 0 `uncaughtException`، 0 `unhandledRejection`.
- **بعد ~4 دقائق:** كل التجمّعات عادت ([`run2-pools-after-4min.json`](raw/batch16-d7/run2-pools-after-4min.json)) والمهام الدورية تعمل. لقطة ما بعد (أ) مباشرة أظهرت `gatewayRequest` و`gatewayDispatch` فقط — إعادة اتصال كسولة عند الطلب، لا فقد.

## 4. الحدود

- تجربة لكل نوع عطل على مثيل واحد، لا تكرار إحصائي ولا عطل تحت حمل. لا تثبت سلوك Supabase/المنصة الحقيقية.
- دليل `stage-2b` لا يُمحى: كان صحيحاً على رأسه (قبل `d8ce3607`)؛ الجديد يمدّه إلى `main` الحالي.
