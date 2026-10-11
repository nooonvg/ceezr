# المرحلة 2.1 — الخطوة 2: طبقة الدومين الخالصة (تقرير إنجاز)

التاريخ: 2026-08-06
الحالة: **منجَزة ومُختبرة** — `bun run typecheck` بلا أخطاء، و`bun test` = **85 اختباراً ناجحاً / 0 فاشل**.

## لماذا هذه الخطوة قبل غيرها؟

الخطوة المخطَّطة أصلاً كانت وصل `packages/shared` بـ Supabase و Upstash Redis، وهي **محجوبة** لأنها تتطلب مفاتيح لم تُسلَّم بعد:
مفتاح `service_role` لمشروع Supabase، ورابط Upstash Redis ورمزه. طبقاً للقاعدة 0.1 (لا كود وهمي) وللقاعدة 0.2
(لا ميزة جديدة قبل أن تعمل التي قبلها فعلياً)، نُفِّذت بدلاً منها الطبقة الوحيدة التي **تُختبر اختباراً حقيقياً بلا أي مفتاح خارجي**:
منطق الدومين الخالص الذي تقوم عليه المطابقة.

## ما نُفِّذ فعلياً (تحوّل من "هيكل فقط" إلى "منفّذ فعلياً")

| الملف | المحتوى الفعلي |
|---|---|
| `packages/domain/geo/value-objects.ts` | `makeCoordinates` بتحقّق من المدى و NaN، `makeDistanceKm` |
| `packages/domain/geo/errors.ts` | `InvalidCoordinatesError`، `InvalidDistanceError` |
| `packages/domain/geo/index.ts` | `haversineKm`، `isWithinRadiusKm`، `proximityFactor` |
| `packages/domain/geo/entity.ts` | `DriverLocation`، `isLocationFresh` |
| `packages/domain/subscription/entity.ts` | `servicesCoveredByPlan`، `isSubscriptionLive`، `coversService` |
| `packages/domain/capability/entity.ts` | `canServe`، `enabledServices` |
| `packages/domain/dispatch/entity.ts` | `rejectionReasonFor`، `scoreCandidate`، `evaluateCandidates`، `selectBroadcastBatch` |
| `packages/domain/transport/entity.ts` | آلة حالات الطلب: `canTransition`، `transition`، `returnToSearching`، `hasExhaustedBroadcastRounds` |
| `packages/domain/{geo,subscription,capability,dispatch,transport}/index.ts` | تصدير الرموز المنفَّذة فقط |
| `scripts/check-migrations.ts` | بوابة تحقق تفحص كل جدول SQL: `city_id` + مفتاح أجنبي + `NOT NULL` + RLS |

بقيت `value-objects.ts` و`events.ts` و`errors.ts` في وحدات dispatch و transport و capability و subscription **هياكل كما هي**،
لأنها لم تُطلب بعد ولا تُختبر بعد (القاعدة 0.8). عدد الملفات الهيكلية الآن **338**، والمنفَّذة فعلياً **13**.

## معادلة المطابقة كما نُفِّذت

```
score = (وزن القرب × دالة القرب) + (وزن التقييم × التقييم ÷ 5)
دالة القرب = 1 − (المسافة ÷ نصف قطر البحث)، وتساوي صفراً خارج نصف القطر
```

كلا المكوّنين في المدى `[0,1]`، فالنتيجة قابلة للتفسير والمقارنة.
**كل** من: نصف قطر البحث، وزن القرب، وزن التقييم، حجم دفعة البثّ، والتقييم الافتراضي للسائق الجديد —
يُمرَّر إلى الدوال كمعاملات في `MatchingParameters`، ومصدره `platform_settings`.
**لا رقم تجاري واحد مكتوب داخل هذه الملفات**، وبوابة CI جديدة ترفض أي `250` أو `400` داخل `apps` أو `packages/domain` أو `packages/application`.

## ترتيب الفلترة (قبل حساب النقاط)

`CITY_MISMATCH` → `EXCLUDED_THIS_ROUND` → `NOT_VERIFIED` → `NOT_AVAILABLE` → `SERVICE_NOT_ENABLED` → `NO_LIVE_SUBSCRIPTION` → `OUT_OF_RADIUS`

الأرخص فحصاً أولاً، والمسافة أخيراً. كل مرشح مستبعد يُعاد مع **سبب صريح**، فلا استبعاد صامت.

## آلة حالات الطلب

```
searching → matched → in_progress → completed
searching → cancelled | failed
matched   → cancelled | searching (دورة بثّ جديدة)
failed    → searching
completed, cancelled = نهائيتان
```

كل انتقال غير مشروع يعيد `Result` خاطئاً بسبب واضح — **لا `throw` لأي خطأ أعمال متوقَّع** (القسم 2 من الأمر الحاكم).
ولا انتقال إلى `matched` أو `in_progress` أو `completed` بلا سائق مُسنَد — نفس القيد مفروض في القاعدة عبر `orders_matched_requires_driver`.

## الاختبارات الحقيقية المضافة

| الملف | العدد | ما يثبته |
|---|---|---|
| `tests/unit/geo.test.ts` | 18 | مسافة جدة↔مكة (~69 كم) وجدة↔الرياض (~850 كم) مقابل مسافات حقيقية، تماثل الاتجاهين، رفض الإحداثيات الشاذة |
| `tests/unit/subscription-capability.test.ts` | 17 | الشهر المجاني الساري/المنتهي، الاشتراك الملغى، خطة "مشاوير فقط" لا تغطي التوصيل، خدمة معطَّلة لا تستقبل عرضاً |
| `tests/unit/dispatch-matching.test.ts` | 24 | كل سبب استبعاد على حدة، معادلة النقاط، **انقلاب الترتيب فعلياً عند تغيير الوزنين وحدهما**، حجم الدفعة من الإعدادات، ترتيب حتمي عند التعادل |
| `tests/unit/order-state-machine.test.ts` | 20 | 13 انتقالاً مشروعاً/مرفوضاً، المسار الكامل، رفض إنهاء رحلة لم تبدأ، عدم تعديل الكائن الأصلي |
| (سابقة) `shared-result`، `shared-i18n` | 6 | نمط `Result` والترجمة |

**الاختبار المفصلي المطلوب في قائمة متطلبات 2.1 (البند 4)** — "ترتيب المرشحين يتغيّر فعلياً عند تغيير الوزنين في
`platform_settings` بلا نشر كود" — منجَز: سائق قريب بتقييم 3.0 يسبق سائقاً بعيداً بتقييم 5.0 عند الأوزان المبذورة
(0.7 / 0.3)، وينقلب الترتيب حين تصبح الأوزان (0.1 / 0.9) — **بلا تعديل سطر كود واحد**.

## بوابات CI المضافة

1. منع `In production this would` (كانت موجودة).
2. **منع الأرقام التجارية المرمَّزة** (`250`، `400`) في `apps` و`packages/domain` و`packages/application`.
3. **منع استيراد `infrastructure` داخل `domain`** — يفحص عبارات `import`/`export … from` فقط، لا التعليقات.
4. **`scripts/check-migrations.ts`** — يرفض أي جدول بلا `city_id` أو بلا مفتاح أجنبي إلى `cities` أو بلا RLS.
   النتيجة الحالية: `✅ 12 جدولاً: كلها تحمل city_id و RLS مفعّلة`.

جميع البوابات الأربع نُفِّذت محلياً ومرّت.

## ما يبقى محجوباً حتى تسليم المفاتيح

| المطلوب | يحجب |
|---|---|
| مفتاح Supabase `service_role` | وصل `packages/infrastructure/persistence` بالقاعدة الحقيقية، واستدعاء الدوال الذرّية من TypeScript |
| رابط Upstash Redis + رمزه | حالة السائق اللحظية، مهلة قبول العرض، منع تكرار الرسائل |
| رمز بوت السائقين + رمز بوت العملاء + سرّ الـ webhook | `apps/gateway` |
| 12 معرّف مجموعة تلغرام (3 لكل مدينة × 4 مدن) | تفعيل أي مدينة (القيد `cities_active_requires_groups` يمنع التفعيل بدونها) |

بلا هذه المفاتيح لا يمكن كتابة أي سطر يمسّ مستخدماً حقيقياً دون مخالفة القاعدة 0.1.

## الخطوة التالية بعد المفاتيح

وصل `packages/infrastructure/persistence` بـ Supabase عبر منفذ (port) واحد، ثم استدعاء `claim_ride` من TypeScript
في اختبار تكامل حقيقي على القاعدة نفسها — خمسة سائقين متزامنين، فائز واحد.
