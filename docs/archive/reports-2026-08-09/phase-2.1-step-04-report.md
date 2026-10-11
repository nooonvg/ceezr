# المرحلة 2.1 — الخطوة 4: بوابة HTTP تعمل فعلاً

## ما كان الاعتراض
مجلد `apps/` كله كان هيكلاً وصفياً (37 ملفاً، ~450 بايت لكل ملف). فلا شيء **يعمل**:
لا خادم يُشغَّل، ولا مسار يُستدعى. الطبقات السابقة (دومين + تطبيق) كانت صحيحة ومُختبَرة لكنها بلا واجهة.

## ما نُفِّذ فعلياً في هذه الخطوة

| الملف | ما فيه |
|---|---|
| `packages/shared/config/index.ts` | `tryLoadConfig` يعيد `Result` ويجمع **كل** المتغيرات الناقصة، ويتحقّق من صحة `PORT` و`SUPABASE_URL`. لا قيمة تجارية فيه. |
| `apps/gateway/src/routes/health.ts` | `GET /health` (حيّ + مدة التشغيل) و`GET /ready` (503 ويسمّي الناقص + فحوص تبعيات قابلة للإضافة). |
| `apps/gateway/src/routes/telegram-webhook.ts` | `POST /webhook/telegram/:bot` بتحقّق **زمن ثابت** من ترويسة `X-Telegram-Bot-Api-Secret-Token`، ورفض البوت المجهول و JSON الفاسد، وتمرير التحديث إلى منفذ `UpdateHandler`. |
| `apps/gateway/src/server.ts` | تركيب تطبيق Hono: المسارات + `notFound` + `onError` لا يكشف تفاصيل داخلية. |
| `apps/gateway/src/index.ts` | إقلاع حقيقي: يفشل بخروج 1 ورسالة عربية تسمّي كل مفتاح ناقص، أو يعمل ويسجّل JSON منظّماً. |
| `apps/workers/src/jobs/expire-offers.ts` | مهمة إنهاء مهلة العروض: تقرأ مهلة **المدينة** من `platform_settings`، تحدّد المنتهية، وتطلب إنهاءها عبر منفذ يقابل `expire_stale_offers`. لا تمسّ عرضاً مقبولاً. |

## دليل أنه يعمل — لا وصف

```
$ bun run start                # بلا مفاتيح
❌ تعذّر إقلاع البوابة:
   متغيرات بيئة ناقصة: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ...
رمز الخروج: 1

$ PORT=3111 ... bun run start
{"message":"البوابة تعمل","port":3111,"env":"development","missingEnv":[]}

GET  /health                          -> {"status":"ok","uptimeSeconds":2}                [200]
GET  /ready                           -> {"status":"ready","missingEnv":[],...}           [200]
POST /webhook/telegram/driver (بلا سرّ) -> {"ok":false,"error":"INVALID_SECRET"}            [401]
POST /webhook/telegram/driver (بسرّ)   -> {"ok":false,"error":"NOT_HANDLED"}               [200]
GET  /nope                            -> {"ok":false,"error":"NOT_FOUND"}                 [404]
```

## الاختبارات
`bun test` → **166 ناجحاً / 0 فاشل** (كانت 130). الجديد:
`tests/unit/gateway-routes.test.ts` (طلبات HTTP فعلية على التطبيق، بلا شبكة)،
`tests/unit/config-loading.test.ts`، `tests/unit/expire-offers-job.test.ts`.
`bun run typecheck` → 0 أخطاء.

## ما لم يُنفَّذ ولماذا — بصراحة
- **معالج التحديثات الحقيقي (grammY)**: البوابة تستقبل التحديث وتتحقّق منه وتسجّله، لكنها تعيد
  `NOT_HANDLED` لأنه لا يوجد بوت مركَّب. تركيبه يحتاج `DRIVER_BOT_TOKEN` و`RIDER_BOT_TOKEN`.
- **محوّلات Supabase و Redis**: العقود (المنافذ) جاهزة ومُختبَرة بمزدوجات، والمحوّل الحقيقي
  يحتاج `SUPABASE_SERVICE_ROLE_KEY`. لن أكتب محوّلاً لا يمكن اختباره فأعلنه "مكتملاً".
- **تفعيل المدن الأربع**: يحتاج 12 معرّف مجموعة تلغرام (القيد `cities_active_requires_groups`).

## المتبقي من عندك لتسليم أول رحلة حقيقية
1. `SUPABASE_SERVICE_ROLE_KEY` 2. رابط Upstash Redis ورمزه
3. رمزا البوتين + سرّ الـ webhook 4. معرّفات 12 مجموعة تلغرام (3 × 4 مدن)
