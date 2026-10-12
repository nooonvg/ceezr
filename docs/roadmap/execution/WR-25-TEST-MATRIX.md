# WR-25 — مصفوفةُ اختباراتِ §25 وأين تُقاسُ

**المرجع:** `ORDER-20261012.md` §25. **التاريخ:** 2026-10-12. **رأسُ `main` عند القياس:** انظر سجلَّ الدمج.

لكلِّ بندٍ من §25: الملفّاتُ التي تقيسُه، ونوعُ القياس (وحدة · HTTP/Router · PostgreSQL حقيقي · Socket.IO حقيقي)، وما لا يُقاسُ آليًّا. التكاملُ يُشغَّلُ في CI في وظيفة «تكامل على PostgreSQL حقيقي» على كلِّ PR، وقد نجحَت في #522 و#523 و#524.

| بند §25 | الملفّات | النوع | ما لا يُقاسُ هنا |
| --- | --- | --- | --- |
| خياراتُ السعرِ الثلاثة وحفظُها وعرضُها للسائق | `tests/integration/wr-05-offer-mode.test.ts` · `tests/unit/wr-05-offer-mode.test.ts` · `apps/miniapp/src/surfaces/rider/wr-17-single-request-form.test.tsx` (نموذجٌ واحدٌ حتى `createServer` البوّابة) | PostgreSQL · وحدة · HTTP | العرضُ في تيليجرام على جهاز (WR-26) |
| وصفُ الطردِ اختياريٌّ في كلِّ مسارات التوصيل | `tests/unit/wr-18-parcel-optional.test.ts` · `tests/unit/parcel-validation.test.ts` · `tests/integration/wr-19-delivery-cycle.test.ts` · `tests/integration/full-delivery.test.ts` | وحدة · PostgreSQL | — |
| منعُ التكرارِ والمدخلاتُ غيرُ الصالحة والوقتُ المجدول | `tests/integration/ride-request.test.ts` (فهرسُ `(rider_id, idempotency_key)`) · `tests/unit/wr-06-no-silent-drops.test.ts` (`PICKUP_AT_INVALID`، الوقتُ الفارغ) | PostgreSQL · وحدة | سياسةُ التوزيعِ المؤجَّل بانتظارِ قرار (`WR-06-DECISION-OPTIONS.md`) |
| إشعارُ السائق و429 والمهلاتُ وإعادةُ المحاولة ومنعُ التكرار | `tests/unit/rate-aware-telegram-sender.test.ts` (`retry_after` حرفًا، الدائمُ لا يُعاد، التراجعُ الأُسّيّ) · `tests/integration/notification-outbox*.test.ts` (10 ملفّات: الالتقاط، المهلة، الموتى، غيرُ القابلِ للتسليم) · `tests/unit/wr-07-offer-notice-trace.test.ts` | وحدة · PostgreSQL | 429 حقيقيٌّ من تيليجرام |
| بطاقةُ العرضِ في البوتِ الصحيح وأزرارُها | `tests/unit/wr-07-offer-notice-trace.test.ts` · `tests/integration/wr-08-offer-card-close.test.ts` · `tests/integration/driver-offers.test.ts` | وحدة · PostgreSQL | البطاقةُ على جهاز (WR-26 الخطوة 3) |
| اختفاءُ العرضِ ممّن رفضَه واستمرارُ الطلبِ لغيره | `tests/integration/dispatch-reject-offer-scoped.test.ts` · `tests/integration/dispatch-redispatch.test.ts` | PostgreSQL | — |
| بطاقةُ اختيارِ السائق ومهلةُ 15 ثانيةً من الخادم | `tests/integration/wr-09-rider-choice.test.ts` · `tests/unit/wr-09-candidate-notices.test.ts` · `tests/integration/wr-24-concurrent-races.test.ts` (٥أ، ٥ب) | PostgreSQL · وحدة | المؤقّتُ على جهاز |
| منعُ قبولِ أكثرَ من سائقٍ أو مرشَّح | `tests/integration/wr-24-concurrent-races.test.ts` (تسعُ حالاتٍ متزامنةٍ فعلًا) · `tests/integration/claim-ride-duplicate-delivery.test.ts` | PostgreSQL متزامن | — |
| المحادثةُ وصلاحياتُها وحفظُها واللحظيّةُ وإعادةُ الاتصال | `tests/integration/order-chat.test.ts` · `tests/integration/wr-04-chat-message-notice.test.ts` · `apps/miniapp/src/surfaces/chat/order-chat.test.tsx` · **`tests/integration/wr-25-chat-realtime-client.test.ts`** | PostgreSQL · Socket.IO حقيقي | — |
| إشعاراتُ الراكبِ بسجلٍّ ونتيجةٍ وإعادة | `tests/integration/wr-15-rider-trip-notice-outbox.test.ts` · `tests/unit/wr-15-bot-trip-notice-outbox.test.ts` | PostgreSQL · وحدة | الوصولُ إلى هاتفٍ حقيقيّ |
| استعادةُ الطلبِ النشطِ والمهمّةِ النشطة | `tests/integration/active-ride.test.ts` · `tests/integration/driver-job.test.ts` · `tests/unit/active-ride-store.test.ts` | PostgreSQL · وحدة | الإغلاقُ وإعادةُ الفتحِ على جهاز |
| حداثةُ الموقعِ والتذكيرُ ونقلُ المدينة | `tests/integration/driver-location-freshness.test.ts` · `tests/integration/wr-12-location-reminder.test.ts` · `tests/integration/wr-13-driver-city-relocation.test.ts` · `tests/unit/wr-11-driver-eligibility-state.test.ts` · `tests/integration/wr-23-driver-selection.test.ts` | PostgreSQL · وحدة | — |
| مسارُ المجموعةِ وغلقُ البطاقة | `tests/integration/unsubscribed-negotiation.test.ts` · `tests/integration/unmatched-escalation.test.ts` · `tests/integration/wr-10-group-card-close.test.ts` · `tests/integration/wr-24-concurrent-races.test.ts` (٧أ، ٧ب) | PostgreSQL | قروبٌ حقيقيّ (WR-26 الخطوة 12) |
| الفرقُ بين المشوارِ والتوصيل والتسميات | `apps/miniapp/src/surfaces/rider/wr-16c-service-fields.test.tsx` · `tests/integration/wr-19-delivery-cycle.test.ts` | وحدة · PostgreSQL | — |
| التحديثُ اللحظيّ: العميلُ الحقيقيُّ ينضمّ | **`tests/integration/wr-25-chat-realtime-client.test.ts`** (مصنعُ مقبسِ Mini App المنشورُ ضدَّ قناةِ البوّابة) · `tests/integration/delivery-realtime.test.ts` · `tests/unit/ride-channel-client.test.ts` | Socket.IO حقيقي | — |

## نتائجُ القياسِ في هذه الجولة (2026-10-12)

- **CI على #523 (`b8ac5cd4`):** كلُّ الفحوصِ المطلوبةِ خضراء، ومنها التكاملُ على PostgreSQL. وأمسكَ CI قبلَها تذبذبًا حقيقيًّا في اختبارِ السباقِ ٤ (مقارنةُ الزمنِ بعدَ قطعِه إلى الملّيثانية) فأُصلِحَ بالمقارنةِ في القاعدة.
- **محليًّا على PostgreSQL 18 + PostGIS بكلِّ الهجرات:** الوحداتُ وتطبيقاتُ المستودع 7530/7530. وتكاملُ WR-23 وWR-24 معًا 15/15 مرّتين، وWR-25 للمحادثة 3/3 ثلاثَ مرّات.
- **التشغيلُ المحلّيُّ لكلِّ ملفّاتِ التكاملِ (170 ملفًّا):** 1479 نجحَت و13 أخفقَت، وكلُّها بيئيّة: جلساتُ Redis بحاوية (لا Docker في البيئة)، وتمرينُ استعادةِ النسخِ الاحتياطيّ (أدواتُ النسخِ والزمن)، واختبارا مخطِّطِ الاستعلام والمُطبِّقِ الآمن (حسّاسانِ للتوقيت). وكلُّها تنجحُ في CI.
