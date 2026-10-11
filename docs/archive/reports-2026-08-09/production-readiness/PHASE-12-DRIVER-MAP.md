# المرحلة ١٢ — خريطةُ السائق ودورةُ حياة التتبّع

- **الحالة**: مُغلقة — البوابة مرَّت
- **القرار المعماري**: [ADR 0021 — خريطةُ السائق أصلٌ تلغرامي لا صفحةُ ويب](../../../adr/0021-driver-map-is-telegram-native.md)
- **خطّ الأساس قبل المرحلة**: `1273 pass / 1 fail` (إخفاقٌ موروثٌ واحد)
- **بعد المرحلة**: `1291 pass / 1 fail` (نفسُ الإخفاق الموروث وحده)

## ١. ما قِيس قبل أيّ تعديل

قِيس ما يراه السائق بمسبار تنفيذٍ (`tmp-probe12.ts`) على قاعدة PostgreSQL حقيقية
بالهجرات مطبَّقة — لا بمراجعة شيفرة. والمسبار حُذف بعد القياس، وما استحقّ البقاء
صار اختباراً.

| الرمز | الخطورة | العيب المقيس | الحالة الآن |
|---|---|---|---|
| P12-1 | P0 | القبولُ يُنتج «الطلب لك. توجّه إلى نقطة الانطلاق.» بلا إحداثية ولا اسمِ انطلاقٍ ولا مقصد | **مُغلق** — بطاقةٌ ودبّوس |
| P12-2 | P1 | `/trip` `/status` `/mytrip` `/route` `/map` كلّها تُجيب «🤔 لم أفهم هذه الرسالة» | **مُغلق جزئياً** — `/trip` وحده نُفِّذ وأُضيف إلى القائمة الدائمة؛ البقيّة لم تُنفَّذ ولا يُدَّعى تنفيذها |
| P12-3 | P0 | جلسةُ التتبّع تبقى مفتوحة بعد `/unavailable`، فيبقى السائق على خريطة العمليات إلى سقف ١٢ ساعة | **مُغلق** — مع بقاءِ نافذةٍ موصوفة في R-45 |
| P12-4 | P1 | رسالةُ بدء الرحلة بلا إحداثية المقصد ولا اسمه | **مُغلق** — البطاقةُ تتبع البدء |

## ٢. الادعاءات، كلٌّ بدليله

### P12-3 — الخروجُ من الخدمة يُغلق الجلسة

- **STATUS**: مُنفَّذ ومُختبَر على قاعدةٍ حقيقية
- **EVIDENCE**: `sessionShouldRun(duty)` في `packages/domain/tracking/session.ts`؛
  `onDutyEnded` وحاجزُ رأس `onFix` في `packages/application/tracking/live-tracking.ts`؛
  `createDriverDutyReader` في `packages/infrastructure/tracking/tracking-queries.ts`؛
  الوصلُ في `apps/gateway/src/container.ts`، والنداءُ في `packages/application/bots/driver-dialog.ts`
- **TEST**: ثلاثةُ اختبارات تكامل في `tests/integration/tracking-realtime.test.ts`:
  الغلقُ بـ`/unavailable` بسبب `DRIVER_STOPPED`؛ الغلقُ عند أوّل إصلاحةٍ بعد خروجٍ
  عبر SQL؛ وعدمُ قطعِ رحلةٍ جارية
- **RISK**: R-45 — الخروجُ عبر SQL (تغييرُ المسؤول، المهمّةُ المجدولة) لا يُنادي
  `onDutyEnded`، فالنافذةُ تُقلَّص إلى أوّل إصلاحةٍ ولا تُلغى

### P12-1 و P12-4 — البطاقةُ والدبّوس

- **STATUS**: مُنفَّذ ومُختبَر
- **EVIDENCE**: `packages/domain/tracking/driver-trip-view.ts` (نقيّ)؛
  `packages/application/tracking/driver-trip-card.ts` (حالةُ الاستخدام والمفتاح)؛
  `packages/application/bots/driver-trip-reply.ts` (النصّ والدبّوس)؛
  `createDriverTripCardReader` (الاستعلام)؛ `mapPin?` على `BotReply`؛
  `sendLocation` إلزاماً على `TelegramSender` وتنفيذُه في `apps/gateway/src/bots/driver/index.ts`
- **TEST**: ١١ اختبارَ وحدة في `tests/unit/driver-trip-view.test.ts` + تأكيداتٌ
  صريحةٌ على البطاقة والدبّوس في `full-ride` و`full-delivery` و`mutual-ratings`
- **RISK**: المسافةُ مستقيمةٌ لا مسافةَ طريق (R-28، تُغلق في المرحلة ١٥/١٦)

### P12-2 — أمرُ `/trip`

- **STATUS**: مُنفَّذ ومُختبَر — **لأمر `/trip` وحده**
- **EVIDENCE**: `case "/trip"` في `driver-dialog.ts`؛ `menu.driver.trip` أوّلَ
  `DRIVER_MENU_ITEMS`؛ ١٦ مفتاحَ ترجمة × ٣ لغات (٢٨٧ مفتاحاً لكلّ لغة بتكافؤٍ صارم)
- **TEST**: `/trip` بلا رحلة، و`/trip` برحلةٍ جارية (تكامل)
- **RISK**: `/status` `/mytrip` `/route` `/map` **لا تزال** تُجيب «لم أفهم». لم تُنفَّذ،
  ولا تُحسَب مُغلقة

## ٣. فحصُ التحوير — ما يُقاس لا ما يُدَّعى

طريقةٌ واحدة: نسخُ الملف، استبدالُ سلوكٍ واحد، تشغيلُ الحزمة المستهدفة، مقارنةُ عدد
الإخفاقات، الاستعادة، والتحقّق من تطابق البصمة بعدها.

| المُحوَّر | النتيجة |
|---|---|
| قلبُ `legOf` (المرحلة معكوسة) | قُتِل — ١٤ إخفاق |
| الوجهةُ دائماً الانطلاق | قُتِل — ٦ إخفاقات |
| إسقاطُ المنزلة العشرية من المسافة | قُتِل — ٣ إخفاقات |
| دبّوسٌ صفريّ بلا وجهة | قُتِل — إخفاق |
| `DRIVER_STOPPED` ⇒ `EXPIRED` (كلا الموضعين) | قُتِل — إخفاق |
| `DRIVER_STOPPED` ⇒ `EXPIRED` (**موضعُ الإصلاحة وحده**) | **نجا أوّلاً** ⇒ كُشِف نقصُ تغطيةٍ حقيقي ⇒ أُضيف اختبارٌ ⇒ قُتِل |
| إسقاطُ حاجز `pickup_lng` | **نجا** — حاجزٌ دفاعيٌّ غيرُ قابلٍ للوصول: نقطةٌ جغرافيةٌ لا تحمل عرضاً بلا طول. مُحوَّرٌ مكافئ لا فجوةُ اختبار |

**ملاحظةُ أمانة**: أوّلُ تشغيلٍ لأداة الفحص أعلن «خطَّ أساسٍ بإخفاقٍ واحد» بسبب خللٍ
في قراءة عدد الإخفاقات من الخَرج — لا بسبب اختبارٍ فاشل. صُحّحت القراءة وأُعيد
التشغيل، وخطُّ الأساس الصحيح صفر. والنتائجُ أعلاه من التشغيل المُصحَّح.

## ٤. البوابة

| الفحص | النتيجة |
|---|---|
| `bunx tsc --noEmit` | أخضر |
| `bunx biome check .` | ٨ أخطاء + تحذير — **مطابقٌ تماماً** لخطّ الأساس المُقاس على `3bf56b9` |
| `bun test` | `1291 pass / 1 fail / 4922 expect() / 1292 tests / 91 files` |
| الإخفاقُ الوحيد | `driver-location-visibility.test.ts` — «إرسال الموقع بعده يُنهي الاستبعاد فوراً»، موروثٌ وينتظر المرحلة ١٤ |
| `bun scripts/check-migrations.ts` | مخالفتان سابقتان (`db_backups`، `webhook_events` بلا `city_id`) — لم تُلمسا |
| `build` | لا سكربتَ بناءٍ في المستودع (Bun يُشغّل TS مباشرةً)؛ الفحصُ النوعي هو البديل |

خطُّ أساس التدقيق قِيس فعلاً لا نُقل عن ذاكرة: `git stash -u` ثمّ `biome check`
على `3bf56b9`، فكان ٨ أخطاء + تحذير. وأُدخل في العمل ثلاثُ ملاحظاتٍ جديدة
(ترتيبُ استيرادٍ في موضعين، وتأكيدُ عدمِ فراغٍ في اختبار) وأُصلحت الثلاثةُ حتى
عاد العدد مطابقاً.

## ٥. الملفات

**أُضيفت (٥)**: `packages/domain/tracking/driver-trip-view.ts` ·
`packages/application/tracking/driver-trip-card.ts` ·
`packages/application/bots/driver-trip-reply.ts` ·
`tests/unit/driver-trip-view.test.ts` · `docs/adr/0021-driver-map-is-telegram-native.md`
(وهذا الملف)

**عُدِّلت (٢٢)**: `session.ts` · `live-tracking.ts` · `tracking-queries.ts` ·
`container.ts` · `driver-dialog.ts` · `rating-dialog.ts` · `bots/types.ts` ·
`main-menu.ts` · `telegram-api-sender.ts` · `bots/driver/index.ts` ·
`i18n/{ar,en,ur}.json` · `scripts/load-test.ts` ·
`tests/support/{telegram-capture,bot-doubles}.ts` ·
`tests/unit/{tracking-realtime,rider-dialog}.test.ts` ·
`tests/integration/{tracking-realtime,full-ride,full-delivery,mutual-ratings}.test.ts`

**لم تُلمس عن قصد**:

| الملف | السبب |
|---|---|
| `apps/gateway/src/bots/rider/index.ts` | لا موضعَ في مسار الراكب يضبط `mapPin`؛ فرعٌ ميّتٌ شيفرةٌ تُصان بلا سبب |
| `apps/gateway/src/bots/driver/trip-lifecycle.ts` | `export {}` سقالةٌ صريحة، ورأسُها يمنع إضافةَ منطقٍ بلا أمرِ تنشيطٍ صريح |
| `packages/application/transport/start-ride.ts` | سقالةٌ كذلك؛ دورةُ الحياة الحقيقية في `packages/application/reputation/ride-lifecycle.ts` |
| `packages/tracking/*` | الشجرةُ الموازية غيرُ الموصولة (R-35) — وصلُها أو حذفُها قرارُ مرحلةٍ أخرى |
| `apps/admin-dashboard/src/map.ts` | `renderMapPanel` بلا مستهلكِ صفحة (R-39) — خريطةُ العمليات هي المرحلة ١٣ |
| هجرات `supabase/migrations` | لا حاجةَ لعمودٍ ولا جدول: البطاقةُ استعلامُ قراءةٍ على أعمدةٍ قائمة |

**حُذف**: `tmp-probe12.ts` (مسبارُ القياس) — ولم يُرفَع في أيّ التزام.

## ٦. الأمن

- لا مفتاحَ قراءةٍ يأتي من العميل: `driverId` مقروءٌ من القاعدة، و`driverTelegramId`
  من تحديث تلغرام الموثَّق. و`tripId` **ليس مفتاحاً** (حكمُ المرحلة ١)
- اختبارٌ يُثبت أنّ سائقاً لا يقرأ رحلةَ غيره (`cardOf` تُجيب `null` بكلا المفتاحين)
- اختبارٌ يُثبت أنّ البطاقة تُرسَل إلى الظافر وحده عند تنافس سائقين
- P12-3 عيبُ خصوصيةٍ أُغلق: من انصرف من عمله لا يبقى موقعُه معروضاً
- لم يُضَف سطحُ HTTP ولا صفحةٌ ولا مسارٌ عامّ — فلا سطحَ تخويلٍ جديد يُراجَع

## ٧. المخاطر الباقية

- **R-28** (قائم): OSRM غير موصول ⇒ المسافةُ مستقيمةٌ موسومة، ولا خطَّ مسارٍ مرسوم
- **R-45** (قائم، مُوثَّق في ADR 0021): الخروجُ من الخدمة عبر SQL لا يُنادي
  `onDutyEnded`؛ النافذةُ حتّى أوّل إصلاحةٍ أو سقفِ ١٢ ساعة
- **جديد — R-46**: `/status` و`/mytrip` و`/route` و`/map` لا تزال تُجيب «لم أفهم».
  عيبُ اكتشافٍ لا عيبُ بيانات، ولم يُنفَّذ في هذه المرحلة
- **جديد — R-47**: `driver-location-visibility` مُخفِق موروثٌ لم يُلمس؛ ينتظر المرحلة ١٤
- **مُحوَّرٌ ناجٍ واحد** غيرُ قابلٍ للوصول (حاجزُ `pickup_lng`) — مُبيَّنٌ أعلاه لا مخفيّ

## ٨. المرحلة التالية

المرحلة ١٣ — خريطةُ العمليات الحيّة، بحالاتها العشر
(`AVAILABLE`/`ASSIGNED`/`TO_PICKUP`/`AT_PICKUP`/`PICKED_UP`/`TO_CUSTOMER`/`ARRIVED`/`COMPLETED`/`OFFLINE`/`STALE`).
وR-39 (`renderMapPanel` بلا مستهلك) يقع في نطاقها.
