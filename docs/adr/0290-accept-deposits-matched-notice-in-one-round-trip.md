# ADR 0290: قبول العرض يودِع إشعار MATCHED في عبارته — رحلة ذهاب وإياب واحدة

> **ملحق (2026-10-20، الدفعةُ 21):** النمطُ نفسُه طُبِّقَ على أطوارِ `arrived/start/complete` (`driver_*_with_notice`، الهجرة `20261020120000`) مع بقاءِ تحقّقِ الجلسةِ القابلةِ للإبطالِ قبلَ المخزن؛ انظر [`BATCH-21-LOAD01-HTTP-QUERY-REDUCTION.md`](../evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/BATCH-21-LOAD01-HTTP-QUERY-REDUCTION.md).

**الحالة:** مقبول
**التاريخ:** 2026-10-19
**المرجع:** [ADR 0117](0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md) · [ADR 0265](0265-rider-trip-notice-outbox.md) · [ADR 0287](0287-rider-trip-events-miniapp-first.md) · `docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/BATCH-15-LOAD01-P2-ACCEPT-ROUNDTRIP.md`
**Work Packet:** `docs/work-packets/load01-p2-accept-roundtrip.json`

## السياق

`POST /v1/driver/offers/:id/accept` كان عبارتين متتاليتين على تجمّع `gatewayRequest`: `driver_accept_offer` ثم `enqueue_rider_trip_notice(order,'MATCHED')` منتظَرة قبل الرد. تحت الحمل كل حجز ينتظر في الطابور مئات الملّي ثانية وتنفيذه ~5ms، فزمن القبول ≈ ضعف الانتظار (مقيس: النسبة 2.09). وكان سقوط العملية بين العبارتين يُفقد إشعار الراكب.

## القرار

1. دالة جديدة `driver_accept_offer_with_matched_notice(bigint, uuid)` تنادي `driver_accept_offer` كما هي، ثم — إن نجح القبول ولم يكن حجزاً بانتظار الراكب (WR-09) — `enqueue_rider_trip_notice(order,'MATCHED')` كما هي داخل كتلة استثناء. الرد هو رد القبول حرفاً مع `rider_notice`.
2. فشل الإيداع تتراجع عنه نقطة الحفظ وحده، والقبول يُثبَّت، ويُعاد `{ok:false,error:'ENQUEUE_EXCEPTION',sqlstate}` فيسجّل التطبيق `rider_trip_notice.enqueue_failed` — ADR 0265 §2 دون تغيير.
3. مسار Mini App يستعملها حين يكون إشعار الراكب موصولاً والمخزن يدعمها؛ وإلا يبقى المسار القديم. والإشارة اللحظية (ADR 0287) من موضع واحد في الحاوية سواء أودع `enqueue` أم عبارة القبول.

## ما لم يتغير

كاتب القبول الوحيد (`claim_ride` عبر `driver_accept_offer`)، فحوص الهوية والملكية، إبطال الجلسة عند الحظر، مفتاح منع التكرار، مسار البوت، الميزانية (21)، ومسار `enqueue_rider_trip_notice` لبقية الأطوار.

## العواقب

- مقيس (تشخيصي، 4 موجات): P2 عند 500 من 875/915ms إلى 513/554ms على المقعد نفسه، والانتظار في الطابور ثابت.
- الإيداع صار في معاملة القبول: لا نافذة فقدان بينهما. وكلفة نقطة حفظ واحدة لكل قبول ناجح.
- لا يغير حكم LOAD-01 (FAIL حتى قبول مؤهل).
