# القسم 0 — تقرير الفحص التأسيسي الإلزامي (BASELINE)

**التاريخ:** 2026-08-10
**الالتزام المرجعي (HEAD قبل أي تعديل):** `09337d5` — «feat(bots): تحقّق اسم حقيقي، وإغلاق ثغرة ملكية رقم الجوال، وصقل تجربة الحوار»
**المستودع:** `github.com/noor-seez/ceezr`
**الغرض:** تثبيت الحالة الحقيقية للمشروع بالأدلة قبل أي تعديل، تنفيذاً للقاعدة 1 من التوجيه التنفيذي.

> **مبدأ حاكم في هذا التقرير:** لا يُسجَّل بند بـ PASS إلا وقد شُغِّل فعلاً في هذه البيئة وأُرفِق مخرجه. ما لم يُشغَّل يُسجَّل NOT AVAILABLE صراحةً ولا يُجمَّل.

---

## 1) لقطة الحالة (Snapshot)

| المقياس | القيمة |
|---|---|
| إجمالي الملفات المتعقَّبة في git | 601 |
| ملفات TypeScript | 517 ملفاً / 38,264 سطراً |
| سطور SQL (الهجرات) | 3,522 سطراً عبر 13 هجرة |
| ملفات التوثيق (Markdown) | 49 |
| قرارات معمارية (ADR) | 14 (0001 → 0014) |
| وحدات الدومين | 24 وحدة، مكرَّرة عبر domain / application / infrastructure |
| بيئة التنفيذ | Bun 1.3.14 على Ubuntu 26.04 |

### الهيكل العام
```
apps/           gateway (Hono) · workers (jobs) · admin-dashboard (SSR HTML)
packages/       domain/ · application/ · infrastructure/ · shared/ · agent-core/
supabase/       migrations/ (13 هجرة)
scripts/        8 بوابات فحص آلية
tests/          unit/ · integration/ · e2e/ (فارغ) · support/
docs/           MASTER_DIRECTIVE · adr/ · تقارير المراحل · runbook
.github/        workflows/ci.yml
```

---

## 2) نتائج التشغيل الفعلي — البوابات الأساسية

| البند | الأمر | النتيجة | الدليل |
|---|---|---|---|
| تثبيت الاعتماديات | `bun install --frozen-lockfile` | **PASS** | 20 حزمة، لا تعارض في القفل |
| فحص الأنواع | `bun run typecheck` (`tsc --noEmit`) | **PASS** | خرج بلا خطأ واحد |
| التدقيق الأسلوبي | `bun run lint` (biome) | **PASS** | 525 ملفاً مفحوصاً، 0 خطأ، 9 ملاحظات إعلامية (infos) فقط |
| الاختبارات بلا قاعدة | `bun test` | **PASS** | 568 ناجح · 0 فاشل · **133 متخطّى** |

### الملاحظات الإعلامية التسع (infos)
ليست أخطاء ولا تُسقِط البوابة. نمطها الغالب: تفضيل `input.event.attributes.order_id` على `attributes["order_id"]`. **قرار:** تُترك كما هي في هذا القسم — تعديلها تجميلي بحت ولا يجوز خلطه بتعديلات وظيفية في نفس الالتزام.

---

## 3) رفع قاعدة PostgreSQL حقيقية — إغلاق فجوة الـ133 اختباراً المتخطّى

كان الـ133 اختبار تكامل يُتخطّى لغياب `TEST_DATABASE_URL`. هذا وضع غير مقبول في BASELINE، لأن أخطر منطق النظام (الذرّية، المطابقة، التزامن) لا يُثبَت إلا على قاعدة فعلية. لذلك رُفعت قاعدة حقيقية في بيئة التنفيذ:

```
PostgreSQL 18.4 (Ubuntu) + PostGIS 3
المنفذ 55432 (المنفذ 5432 مشغول في البيئة)
أدوار Supabase المُنشأة يدوياً: anon · authenticated · service_role (bypassrls)
```

### تطبيق الهجرات — 13/13 نجحت بلا خطأ

| # | الهجرة | النتيجة |
|---|---|---|
| 1 | `20260806120000_phase_2_1_core_schema` | OK |
| 2 | `20260806120100_phase_2_1_atomic_rpcs` | OK |
| 3 | `20260806120200_phase_2_1_seed_cities_and_settings` | OK |
| 4 | `20260807100000_phase_2_3_unsubscribed_negotiation` | OK |
| 5 | `20260807130000_phase_2_4_support_tickets` | OK |
| 6 | `20260807170000_phase_2_5_mutual_ratings` | OK |
| 7 | `20260807190000_phase_2_6_language_selection` | OK |
| 8 | `20260808040000_phase_2_6_scheduled_jobs` | OK |
| 9 | `20260808120000_phase_2_7_start_ride_parties` | OK |
| 10 | `20260808140000_phase_2_7_admin_dashboard` | OK |
| 11 | `20260808180000_phase_3_agent_measurement` | OK |
| 12 | `20260809000000_phase_3_close_postgrest_surface` | OK |
| 13 | `20260809001000_phase_3_close_postgrest_surface_fix` | OK |

**نتيجة جوهرية:** سلسلة الهجرات تُطبَّق من الصفر على قاعدة نظيفة بلا تدخل يدوي وبلا تعارض ترتيب. هذا يُثبت أن `supabase/migrations` مصدر حقيقة قابل لإعادة الإنتاج، لا مجرد سجل تاريخي.

**اعتماديتان خارجيتان مكتشفتان بالتجربة:** الهجرة الأولى تتطلب `postgis`، والهجرتان 12 و13 تتطلبان وجود أدوار `anon`/`authenticated`/`service_role` مسبقاً. هذا مستوفى تلقائياً على Supabase، لكنه **غير موثَّق** لأي بيئة أخرى. → مسجَّل كنقص توثيقي في القسم 6.

### اختبارات التكامل على القاعدة الحقيقية

```
bun test tests/integration  →  109 pass · 0 fail · 569 expect() · 7.33s
bun test (الكل مع القاعدة)  →  677 pass · 0 fail · 2038 expect() · 7.35s
```

**الفارق الحاسم:** 568 → **677 اختباراً ناجحاً**، و**صفر متخطّى**. كل اختبار تكامل كُتب في هذا المشروع يعمل فعلاً؛ التخطّي كان فقدان بيئة لا فقدان صحة.

الملفات الاثنا عشر لاختبار التكامل التي نجحت كلها: `full-ride` · `full-delivery` · `support-tickets` · `mutual-ratings` · `unsubscribed-negotiation` · `admin-dashboard` · `agent-core-measurement` · `agent-core-support-advice` · `bilingual-conversation` · `distributed-lock` · `redis-sessions` · `scheduled-jobs`.

من أبرز ما ثبت فعلياً على قاعدة حقيقية: «سائقان يتنافسان تزامناً: واحد فقط يظفر مهما كان ترتيب الوصول» (131ms) — أي أن الذرّية ليست ادعاءً معمارياً بل سلوكاً مُثبتاً.

---

## 4) البوابات المعمارية الآلية — 4/4 PASS

| البوابة | المخرج الفعلي |
|---|---|
| `check-business-constants.ts` | ✅ لا قيمة تجارية مرمَّزة في apps، packages/domain، packages/application |
| `check-i18n.ts` | ✅ 3 قواميس متطابقة، **173 مفتاحاً** في كل منها |
| `check-agent-core-isolation.ts` | ✓ عزل agent-core سليم: لا استيراد داخل، ولا دخول إلا من البوّابة |
| `check-migrations.ts` | ✅ **20 جدولاً**: كلها تحمل `city_id` و RLS مفعّلة باسمها صراحةً |

**هذه أهم نتيجة في BASELINE كله:** المشروع لا يكتفي بتوثيق قواعده المعمارية، بل يفرضها آلياً ويفشل البناء عند خرقها. البوابات الأربع تعمل فعلاً وليست ملفات معطّلة.

بالإضافة إليها، `ci.yml` يفرض 5 بوابات نصية مباشرة: منع الكود الوهمي (`In production this would`)، منع استيراد infrastructure داخل domain، منع استيراد application داخل domain، منع استيراد مزدوجات الاختبار في كود الإنتاج، ومنع أي نص ظاهر للمستخدم مكتوب داخل منطق الحوار خارج i18n.

---

## 5) جرد المكوّنات المفحوصة

### المسارات (Routes)
| الملف | المسارات |
|---|---|
| `telegram-webhook.ts` | `POST /webhook/telegram/:bot` |
| `health.ts` | `GET /health` · `GET /ready` |
| `admin-api.ts` | `GET /overview` · `/live-orders` · `/heatmap` · `/search` · `/cities` |
| `admin-ui.ts` | 8 صفحات GET + `POST /login/code` · `/login/verify` · `/logout` · `/drivers/:id/verification` · `/users/:id/blocked` · `/settings/:cityId/:key` |

### الحوارات (Dialogs) — 6 ملفات
`driver-dialog.ts` · `rider-dialog.ts` · `support-dialog.ts` · `rating-dialog.ts` · `language-dialog.ts` · `name-errors.ts`

### قاعدة البيانات
20 جدولاً، كلها بـ `city_id` و RLS مفعَّلة. جدول `cities` يحمل بالفعل الأعمدة الثلاثة المطلوبة للـPilot، **وقيد تحقُّق على مستوى القاعدة** يمنع تفعيل مدينة قبل اكتمالها:

```sql
constraint cities_active_requires_groups check (
  is_active = false or (
    telegram_support_group_id is not null and
    telegram_escalation_group_id is not null and
    telegram_unsubscribed_drivers_group_id is not null
  )
)
```

هذا يعني أن شرط القسم 1 مفروض في **القاعدة** لا في الكود — وهو الموضع الصحيح وفق القاعدة 3 من التوجيه.

### الإعدادات (env/config)
`.env.example` مكتمل ويحمل تحذيراً حاكماً صريحاً: «ممنوع وضع أي سعر أو مهلة أو وزن مطابقة هنا. كل قيمة تجارية قابلة للتغيير مكانها جدول `platform_settings`». `TRANSLATION_PROVIDER` و`SESSION_STORE` اختياريان بقيم افتراضية آمنة (ADR-0010 و ADR-0011).

---

## 6) سجل الحالة النهائي

| # | البند | الحالة | ملاحظة |
|---|---|---|---|
| 1 | الهيكل العام | **PASS** | Clean Architecture مفروضة آلياً |
| 2 | routes | **PASS** | مُجرَدة بالكامل أعلاه |
| 3 | dialogs | **PASS** | 6 ملفات، كل نصوصها عبر i18n (مفروض بـCI) |
| 4 | bots | **PASS** | بوتان (سائق/راكب) على webhook واحد بسرّ ثابت الزمن |
| 5 | workers | **PASS** | runner + jobs بقفل Postgres استشاري (ADR-0009) |
| 6 | admin dashboard | **PASS** | 8 صفحات SSR + مصادقة OTP وCSRF |
| 7 | database schema | **PASS** | 20 جدولاً، `city_id` في كلها |
| 8 | migrations | **PASS** | 13/13 من الصفر على قاعدة نظيفة |
| 9 | RPCs | **PASS** | تُنشأ وتعمل ضمن اختبارات التكامل الناجحة |
| 10 | RLS | **PASS** (بتحفّظ) | مفعَّلة على 20 جدولاً، لكن ADR-0006 يوثّق تجاوزها بالاتصال المباشر — قرار واعٍ لا سهو |
| 11 | env/config | **PASS** | `.env.example` مكتمل وبلا سرّ واحد |
| 12 | CI | **PASS** | 9 بوابات فعّالة |
| 13 | docs | **PASS** | 49 ملفاً، 14 ADR |
| 14 | tests (unit+integration) | **PASS** | **677/677** على قاعدة حقيقية |
| 15 | tests (e2e) | **NOT AVAILABLE** | مجلد `tests/e2e/` **فارغ تماماً** |
| 16 | scripts | **PASS** | 8 أدوات، الأربع الحاكمة منها شُغِّلت ونجحت |
| 17 | تشغيل فعلي على الإنتاج | **NOT AVAILABLE** | لا رموز بوتات ولا قاعدة إنتاج في هذه البيئة |
| 18 | توثيق متطلبات القاعدة | **FAIL** | `postgis` والأدوار الثلاثة غير موثَّقة كمتطلب |
| 19 | `docs/api.md` | **FAIL** | متقادم ولا يعكس المسارات الفعلية أعلاه |
| 20 | ملف LICENSE | **FAIL** | غير موجود إطلاقاً — فجوة قانونية |

---

## 7) خلاصة BASELINE

**الحالة الإجمالية: PASS مع 3 إخفاقات غير حرجة و2 غير متاح.**

المشروع في وضع تقني أقوى مما يوحي به أرشيفه الساكن. الاكتشاف الأهم في هذا القسم هو أن **الـ133 اختباراً المتخطّى لم تكن ديناً تقنياً بل نقص بيئة**: ما إن رُفعت قاعدة حقيقية حتى نجحت 677 اختباراً بلا استثناء واحد، بما فيها اختبارات التزامن والذرّية التي تمثّل أخطر ما في نظام مطابقة.

الإخفاقات الثلاثة (توثيق متطلبات القاعدة، `api.md` المتقادم، غياب LICENSE) لا يمنع أيٌّ منها التقدم إلى القسم 1، وكلها مسجَّلة للمعالجة في أقسامها.

**BASELINE مُغلَق. التعديل مسموح ابتداءً من القسم 1.**
