# المرحلة 2.1 — الخطوة 6: الوصل بقاعدة بيانات حقيقية

> **ملخّص بسطر واحد**: انتهى عهد الهياكل. صار في المستودع مسار واحد يبدأ من طلب HTTP وينتهي بصفوف
> حقيقية في `orders` و`order_offers` و`audit_log` على PostgreSQL فعلية، ومُثبَت بتسعة اختبارات تكامل تعمل.

## 1. ما استُدعي هذا العمل

راجعٌ خارجيّ فحص المستودع وخلص إلى أنّ «لا مسار واحد يلمس قاعدة بيانات حقيقية»، وأنّ حجّة انتظار
مفتاح الخدمة صحيحة جزئياً فقط، لأنّ PostgreSQL محلية ممكنة بلا أي مفتاح إنتاج. الملاحظة صحيحة،
والتقرير أدناه ردٌّ عمليّ عليها بنداً بنداً.

## 2. ردّ بند ببند على ملاحظات المراجعة

| # | الملاحظة | الحالة الآن | الدليل |
|---|---|---|---|
| 1 | لا مسار يلمس قاعدة حقيقية | **حُلَّت** | 9 اختبارات تكامل على PostgreSQL+PostGIS، من webhook إلى صفوف الجداول |
| 2 | معالج وهمي في `index.ts` يعيد `false` | **حُذف** | `handler: container.handler` — التركيب الحقيقي |
| 3 | 25 وحدة `infrastructure` هياكل من 8 أسطر | **8 محوّلات منفَّذة** (801 سطراً) | `packages/infrastructure/{db,policy,geo,identity,subscription,transport,dispatch,notification}` |
| 4 | `tests/integration` و`tests/e2e` فارغان | **`tests/integration` يعمل** | `tests/integration/full-ride.test.ts` |
| 5 | حجّة انتظار المفاتيح | **سقطت** | Postgres محلية موثّقة في `docs/runbook.md`، وخدمة `postgis` في CI |
| 6 | `lint` مجرّد `tsc --noEmit` | **Biome حقيقي** | `biome.json`، و`lint` منفصل عن `typecheck` في CI |
| 7 | «الخطوة 4» مكرّرة ومتناقضة | **نُظِّفت** | `docs/archive/reports-2026-08-09/roadmap.md` — سطر واحد لكل خطوة |
| 8 | i18n بُني قبل موعده بلا توثيق | **مُوثَّق انحرافاً واعياً** | `docs/adr/0005-i18n-extracted-early.md` |

## 3. ما بُني فعلاً

### 3.1 محوّلات قاعدة البيانات (الطبقة التي كانت مفقودة)

| الملف | ينفّذ | ملاحظة |
|---|---|---|
| `infrastructure/db/client.ts` | اتصال `postgres` واحد + `guard()` | كل خطأ قاعدة يُغلَّف في `Result` — لا `throw` يعبر الحدود |
| `policy/settings-repository.ts` | `SettingsRepository` | يقرأ `platform_settings` بأولوية المدينة على العام |
| `geo/city-directory.ts` | `CityDirectory` | المدن المفعَّلة فقط |
| `identity/directories.ts` | `DriverDirectory` + `RiderDirectory` | تسجيل السائق **معاملة واحدة** عبر 4 جداول |
| `subscription/subscription-adapters.ts` | `SubscriptionReader` + `TrialRpcPort` | التجربة عبر `start_trial` الذرّية |
| `transport/order-adapters.ts` | `OrderRepository` + `OrderWriter` + بحث الطلب النشط | الإحداثيات `geography(Point,4326)` حقيقية |
| `dispatch/dispatch-adapters.ts` | 6 منافذ: المرشحون، العروض، فتح الدورة، `claim_ride`، قرار العرض، موقع السائق | المرشحون بفلترة SQL على المدينة والتوافر والتحقّق والاشتراك الحيّ |
| `notification/telegram-driver-notifier.ts` | `DriverNotifier` | يقرأ `telegram_id` من القاعدة ويرسل بزرّي قبول/رفض |

### 3.2 `broadcastOffers` — الحلقة التي كانت مقطوعة

كان `matchOrder` يُرجع دفعة سائقين… ولا أحد يفعل بها شيئاً. الآن
`packages/application/dispatch/broadcast-offers.ts` يأخذ القرار، ويكتب صفوف `order_offers` بمهلة
مأخوذة من `platform_settings`، ثم يُخطر كل سائق في الدفعة. سائق حجب البوت يُحسب `unreachable`
ولا يُوقف بقية الدفعة، وفشل كتابة الدورة يمنع الإخطار كليّاً فلا يُخطَر أحد بعرض غير موجود.

### 3.3 موقع السائق — ثغرة وظيفية كانت ستقتل المطابقة

المطابقة تحتاج `last_location`، ولم يكن في الحوار أي طريق لتعبئته: كل سائق يسجّل كان يبقى بلا موقع
إلى الأبد، فلا يظهر في أي دفعة. أُضيف:
- إرسال الموقع يُحفَظ فوراً في `drivers.last_location` (وإحداثيات مستحيلة تُرفض في الدومين).
- `/available` من سائق بلا موقع يُتبَع بطلب موقع بزرّ `request_location`.

### 3.4 `container.ts` و`index.ts`

`buildContainer(config)` ينشئ اتصال قاعدة واحداً ويوصّل 11 منفذاً بمحوّلاتها الحقيقية، ويقبل
استبدال مُرسِلَي تلغرام (وهو ما يجعل اختبار المسار كاملاً ممكناً بلا شبكة). `index.ts` صار:
معالج حقيقي، فحص جاهزية يستعلم القاعدة فعلاً، وإغلاق نظيف على `SIGTERM`/`SIGINT`.

فحص الجاهزية مُثبَت عملياً: برابط قاعدة سليم `200 {"status":"ready"}`، وبرابط معطّل
`503 {"status":"not_ready","failedChecks":["database"]}`.

## 4. الاختبارات — ما الذي يُثبَت فعلاً

**229 اختبار وحدة + 9 اختبارات تكامل، صفر فشل.**

اختبارات التكامل تعمل على قاعدة حقيقية عبر HTTP webhook، وتتحقّق من صفوف الجداول لا من قيم مُرجَعة:

1. تسجيل سائق → صفوف حقيقية في `users`/`drivers`/`driver_capabilities`/`driver_availability`،
   والجوال مُوحَّد `+9665…`، والتجربة المجانية بمدّة مقروءة من `trial_days` لا من ثابت.
2. التوافر قبل تحقّق الإدارة مرفوض؛ وبعده يُكتب في `driver_availability` ويُسجَّل في `attendance_log`.
3. سعر الاشتراك المعروض مطابق لـ `subscription_price_transport` في القاعدة.
4. **المسار الكامل**: طلب بإحداثيات حقيقية → عرض في `order_offers` بمسافة محسوبة (< 1 كم)
   → إخطار السائق بزرّي قبول/رفض → قبول عبر `claim_ride` → الطلب `matched` والعرض `accepted`
   وأثر `order.claimed` في `audit_log`.
5. سائق غير متاح → لا عرض إطلاقاً، والطلب يبقى `searching`.
6. **سباق سائقين على طلب واحد**: الأقرب أعلى نقاطاً، الأول يظفر والثاني يُبلَّغ `offer_taken`،
   وصفّ واحد `accepted` لا غير.
7. الرفض يُسجَّل فوراً، والقبول بعده مرفوض والطلب يبقى `searching`.
8. إلغاء العميل يكتب `cancelled` مع `cancelled_reason`.
9. مدينة غير مفعَّلة لا تُعرض ولا يُسجَّل فيها أحد.

## 5. البوابات — ما تغيّر في CI

- **وظيفة ثانية `integration`**: تُشغّل خدمة `postgis/postgis:17-3.5`، تُنشئ أدوار Supabase،
  تطبّق الهجرات الثلاث بالترتيب، ثم تُشغّل اختبارات التكامل — **وترفض تخطّيها صامتاً**.
- `lint` صار `biome check .` منفصلاً عن `typecheck`.
- بوابة الأرقام التجارية صارت سكربتاً (`scripts/check-business-constants.ts`) بدل `grep`،
  لأن الـ`grep` القديم كان يلتقط رمز حالة HTTP رقم 400 في `telegram-webhook.ts` — أي أنّ **البوابة
  كانت حمراء ولم يُلحَظ**. السكربت يستثني رموز البروتوكول ويمنع قيم السياسة.
- أُصلح `scripts/check-migrations.ts`: كان يقرأ أجسام الجداول بإزاحة خاطئة فيُبلّغ عن 22 مخالفة وهمية.

## 6. ما لم يُبنَ — بصراحة

- **`tests/e2e` ما زال فارغاً**: الاختبار الطرفي الحقيقي يعني بوتاً حقيقياً على تلغرام، وهو محجوب
  برموز البوتين. لا يُملأ بمحاكاة تُسمّى e2e.
- **RLS غير مُختبَرة محلياً**: الاختبارات تعمل بدور superuser يتجاوز السياسات. اختبار السياسات نفسها
  مكانه مشروع Supabase الحقيقي بمفاتيح `anon`/`authenticated`.
- **الجلسات في الذاكرة**: `createMemorySessionStore` — تُستبدل بـ Upstash Redis بسطر واحد في
  `container.ts` عند وصول الرابط. حتى ذلك الحين إعادة تشغيل الخادم تفقد الحوارات نصف المكتملة.
- **دورات البثّ التالية**: `broadcastOffers` ينفّذ الدورة الحالية؛ إعادة البثّ بعد انتهاء المهلة
  تحتاج عاملاً على Cron حقيقي.
- **17 وحدة `infrastructure` ما زالت هياكل** عن قصد (delivery، reputation، dispute، messaging،
  financial، وغيرها) — لا تُفعَّل إلا بأمر صريح.

## 7. الباقي لإغلاق المرحلة 2.1

المفاتيح: `DATABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`، Upstash (رابط + رمز)، `DRIVER_BOT_TOKEN`،
`RIDER_BOT_TOKEN`، `TELEGRAM_WEBHOOK_SECRET`، و12 معرّف مجموعة تلغرام (3 لكل مدينة — القيد
`cities_active_requires_groups` يمنع التفعيل بدونها). بعدها: نشر على Render، ثم معيار الخروج
الحقيقي — **20 إلى 30 رحلة مكتملة فعلاً بلا تدخّل يدوي واحد في القاعدة**.
