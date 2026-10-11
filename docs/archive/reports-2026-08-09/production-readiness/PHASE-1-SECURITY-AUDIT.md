# المرحلة ١ — التدقيق الأمني

**الحالة:** مغلقة. **التاريخ:** ٢٠٢٦-٠٨-١٢. **الفرع:** `main`.

القاعدة الحاكمة لهذه المرحلة: لا يُقبل «الملف موجود» دليلاً على «الحماية قائمة». كل نتيجة
أدناه مقيسة من قاعدة PostgreSQL حقيقية (18.4 + PostGIS 3.6، الهجرات الست والعشرون مطبَّقة)
أو من قراءة الكود المنفَّذ، لا من قراءة نيّة الهجرة.

---

## ١) ما تم فحصه

| السطح | الملفات/الكائنات |
|---|---|
| نقاط الدخول | `apps/gateway/src/server.ts`, `index.ts`, `routes/telegram-webhook.ts`, `routes/payment-webhook.ts`, `routes/admin-api.ts`, `routes/admin-ui.ts`, `routes/health.ts` |
| المصادقة والجلسات | `apps/gateway/src/admin/auth.ts`, `admin/guard.ts`, `admin/queries.ts` |
| XSS | `apps/admin-dashboard/src/layout.ts` وكل مسارات `innerHTML` |
| حقن SQL | كل استعمالات `sql.unsafe` (٦ مواضع) |
| تنفيذ تعسّفي | بحث شامل عن `eval`, `new Function`, `child_process`, `execSync` |
| الأسرار | `packages/shared/config/index.ts`، وكل سطور التسجيل |
| قاعدة البيانات | ٢٥ جدولاً، ٤٩ دالة `security definer`، ACL المخطط، `pg_default_acl`، سياسات RLS |
| التسليم المستمر | `.github/workflows/ci.yml` |

---

## ٢) ما لم يُلمس ولماذا

- **`telegram-webhook.ts`** — فُحص ولم يُعدَّل. مقارنة السرّ بزمن ثابت، قراءة الجسم محدودة
  بـ256KiB بالبثّ لا بعد التحميل، ٤١٣ عند التجاوز، تحقّق من شكل JSON، منع تكرار التحديث،
  حدّ نداءات للمجسّات لا يُحتسب إلا بعد فشل السرّ. لا نقص يستدعي تغييراً.
- **`admin/guard.ts`** — فُحص ولم يُعدَّل. كوكي `HttpOnly` + `SameSite=Strict`، و`secure`
  مشتقّ من `x-forwarded-proto`، ورمز CSRF مشتقّ بـSHA-256 من بصمة رمز الجلسة، ومقارنة
  `safeEqual` بزمن ثابت، و`touch_admin_session` تعيد التحقق من صفة المسؤول في كل طلب.
- **`payment-webhook.ts`** — فُحص، **ولم يُعدَّل عمداً**. الدفع خارج نطاق الإصدار بقرار
  صريح من المالك، وإغلاق المسار كلّه محلّه المرحلة ١٩. ملاحظاته مسجّلة في المخاطر أدناه.
- **الهجرتان `20260809000000` و`20260811160000`** — لم تُحرَّرا. هجرة مطبَّقة لا تُعاد كتابتها؛
  التصحيح يأتي بهجرة لاحقة تشرح الخطأ (وهو ما فُعل).

---

## ٣) النتائج الأمنية

### P0-A — سياسات RLS خاملة على جداول المال (مُصلَح)

`20260811160000_payment_rls_policies.sql` يفتتح بجملة: «الجداول لها RLS مُفعَّل لكن بلا
سياسات — هذا آمن افتراضياً». **المقدّمة غير صحيحة.** الجداول الأربعة لم يُفعَّل عليها RLS قط،
وسياسةٌ على جدول بلا RLS سياسةٌ لا أثر لها.

**الدليل (قبل الإصلاح):**

```
relname             | relrowsecurity | policies
--------------------+----------------+---------
db_backups          | f              | 2
ledger_entries      | f              | 2
payment_transactions| f              | 2
webhook_events      | f              | 2
```

الجداول الأحد والعشرون الأخرى: `relrowsecurity = t` وبلا سياسات، أي مغلقة تماماً — وهو
الوضع الصحيح المقصود. الأربعة وحدها شذّت.

### P0-B — انفتاح تنفيذ الدوال لـ PUBLIC بعد ٢٠٢٦-٠٨-٠٩ (مُصلَح)

خمس دوال `security definer` أُنشئت بعد هجرة إغلاق السطح ووُلدت كلّها بصلاحية التنفيذ
الافتراضية الممنوحة لـ`PUBLIC`، و`anon` عضو في `PUBLIC`:

| الدالة | الهجرة | `proacl` |
|---|---|---|
| `create_payment(...)` | `20260811150000_payment_core` | `NULL` (= مفتوح) |
| `confirm_payment(uuid,text,text)` | `20260811150000_payment_core` | `NULL` |
| `record_webhook_event(text,text,text)` | `20260811150000_payment_core` | `NULL` |
| `update_driver_city(uuid,uuid)` | `20260811_city_change_rpc` | `NULL` |
| `update_rider_city(uuid,uuid)` | `20260811_city_change_rpc` | `NULL` |

**الدليل (قبل الإصلاح):** `has_function_privilege('anon', oid, 'EXECUTE') = true` للخمس
جميعاً، مقابل `postgres=X/postgres | service_role=X/postgres` للدوال الأربع والأربعين السابقة.

**السبب الجذري — وهو الأهمّ في هذا التقرير.** الهجرتان `20260809000000` و`20260809001000`
اعتمدتا على `alter default privileges ... revoke execute on functions from public` لمنع عودة
الانفتاح مع أي دالة جديدة. **هذا السطر لا يفعل شيئاً.** منحة التنفيذ لـ`PUBLIC` تصدر من محرّك
PostgreSQL نفسه لا من منحة مسجَّلة، و`ALTER DEFAULT PRIVILEGES` لا يستطيع تمثيل سحبها،
فيمرّ بلا خطأ وبلا أثر.

**البرهان المباشر** (قاعدة نظيفة، PostgreSQL 18.4):

```
> alter default privileges in schema public revoke execute on functions from public;
ALTER DEFAULT PRIVILEGES
> select count(*) from pg_default_acl;
0                          ← لم تُسجَّل أي قاعدة
> create function public.probe_fn() returns int language sql as 'select 1';
> select proacl, has_function_privilege('probe_anon', oid, 'EXECUTE') from pg_proc …;
NULL_DEFAULT_OPEN | t      ← الدالة الجديدة مفتوحة رغم «المنع»
```

وفي قاعدة المشروع نفسها: `pg_default_acl` **فارغ** رغم تنفيذ ستة أسطر `alter default
privileges` في الهجرتين. الحماية التي ظنّ الفريق أنه ثبّتها لم تكن موجودة أصلاً.

**نتيجة عملية يجب ألا تُنسى:** لا توجد آلية على مستوى الهجرات تُبقي هذه الطبقة مغلقة
تلقائياً. كل دالة جديدة ستولد مفتوحة. لذلك **الضمانة الحقيقية هي الاختبار الحارس، لا الهجرة**.

### هل كان الثقب مُستغَلاً اليوم؟ لا — وهذا يجب أن يُقال بدقة

`20260809001000` سحبت `usage on schema public` من `PUBLIC` نفسه (بعد أن اكتشفت أن سحبها من
`anon` بالاسم لا يكفي). وبلا USAGE لا يُحلّ اسم أي كائن داخل المخطط.

**الدليل:** `has_schema_privilege('anon','public','USAGE') = false`.

فالوصف الصحيح: **لم يكن الثقب قابلاً للاستغلال، لكن الحماية كلّها صارت معلّقة على طبقة
واحدة.** أي منحة `usage` لاحقة — من هجرة، أو من قالب Supabase، أو من ضغطة في لوحة التحكم —
كانت ستفتح فوراً «تأكيد دفعة» و«نقل سائق بين المدن» لأي حامل لمفتاح `anon` العلني. ولأن
الطبقتين الثانية والثالثة كانتا مفقودتين، ما كان لشيء أن يوقف ذلك.

### P0-C — سرّ الويبهوك بلا حدّ أدنى للقوّة (مُصلَح)

نموذج الهوية كلّه يثق بـ`update.message.from.id` بعد اجتياز السرّ. أي أن تخمين السرّ =
انتحال أي سائق أو راكب. `docs/render-deployment-vars.md` تشترط «≥ ٣٢ محرفاً ASCII» منذ
البداية، لكن `isBlank()` في `packages/shared/config/index.ts` كان يرفض الفارغ فقط. الشرط بقي
توصيةً تُخالَف بلا إنذار.

---

## ٤) ما تم تغييره

### ملفات أُضيفت

| الملف | الدور |
|---|---|
| `supabase/migrations/20260812000000_phase_1_seal_definer_surface.sql` | تفعيل RLS على الجداول الأربعة، وسحب التنفيذ من `PUBLIC` عن دوالّنا مع إعادة منحه لـ`service_role`، وإعادة تثبيت القفل الجامع |
| `tests/integration/database-privilege-surface.test.ts` | الحارس الدائم — أربعة اختبارات تقيس الطبقات الثلاث من القاعدة نفسها |

### ملفات عُدِّلت

| الملف | التغيير |
|---|---|
| `packages/shared/config/index.ts` | فرض `MIN_WEBHOOK_SECRET_LENGTH = 32` ومجموعة محارف تلغرام (`A-Za-z0-9_-`) على `TELEGRAM_WEBHOOK_SECRET` **في الإنتاج وحده** |
| `tests/unit/config-loading.test.ts` | أربعة اختبارات للقيد الجديد، وتمرير سرّ مستوفٍ في اختبار تمييز البيئة حتى لا يقيس شيئين معاً |

**قرارات تصميم تستحق التسجيل:**

- القيد على السرّ **إنتاجي فقط**. فرضه في كل البيئات كان سيُسقط اختبارات وحدة قائمة تستعمل
  أسراراً قصيرة مقروءة عمداً — وذلك تعارض مع جزء آخر يخالف القاعدة ٧.
- الهجرة **تستثني دوال الامتدادات** عبر `pg_depend deptype='e'`. `revoke ... on all functions
  in schema public` كان سيشمل مئات دوال PostGIS ويكسر التطبيق.
- **لم تُحرَّر** الهجرتان الخاطئتان. التصحيح بهجرة جديدة تشرح الخطأ في رأسها.

---

## ٥) الاختبارات

### أُضيفت

`tests/integration/database-privilege-surface.test.ts` — أربعة اختبارات:

1. الطبقة ١: كل جدول من جداولنا عليه RLS مُفعَّل (باستثناء `spatial_ref_sys` المملوك لـPostGIS).
2. الطبقة ٢: لا دالة من دوالّنا قابلة للتنفيذ من `anon` ولا `authenticated`.
3. الطبقة ٣: لا `USAGE` على مخطط `public` لأيٍّ من الدورين.
4. جداول المال: RLS مُفعَّل **و** سياسات قائمة معاً — لا سياسة خاملة.

الاختبار الثاني يتحقق أولاً من `rows.length > 0` كي لا يمرّ زوراً على قائمة فارغة.

`tests/unit/config-loading.test.ts` — أربعة اختبارات: رفض القصير، رفض المحارف غير المقبولة
حتى مع الطول الكافي، قبول المستوفي، وعدم فرض القيد خارج الإنتاج.

### نتائج التشغيل

**الحارس قبل الإصلاح — فشل كما يجب (وهذا هو الدليل على أنه يقيس شيئاً حقيقياً):**

```
1 pass, 3 fail
الطبقة ١: db_backups, ledger_entries, payment_transactions, webhook_events  ← RLS مطفأ
الطبقة ٢: confirm_payment, create_payment, record_webhook_event,
          update_driver_city, update_rider_city                             ← مفتوحة لـanon
الطبقة ٣: pass                                                              ← القفل الجامع صامد
```

**الحارس بعد تطبيق الهجرة:**

```
4 pass, 0 fail, 14 expect() calls
```

**الحزمة الكاملة:** `1052 pass / 1 fail / 4038 expect() / 77 ملفاً / 23.4s`

الفشل الوحيد هو `driver-location-visibility` المتروك **أحمر عمداً** منذ المرحلة ٠٫٥ ليكون
بوابة المرحلة ١٤ (لا إعادة بثّ للعرض حين يصير السائق مؤهَّلاً). لا علاقة له بهذه المرحلة.

**Typecheck:** `tsc --noEmit` — صفر أخطاء.

**Lint:** `biome check` على الملفات الأربعة المتغيّرة — نظيف. الـ١٤ خطأ الموروثة على مستوى
المستودع لم تُمسّ (محلّها المرحلة ٢٢).

**Build:** لا سكربت بناء بعد (محلّه المرحلة ٢٥).

---

## ٦) تصحيح لادعاء سابق في تقاريري

سجّلت في المرحلة ٠٫٥ أن «CI لا يشغّل اختبارات التكامل إطلاقاً — لا `services:` ولا
`TEST_DATABASE_URL`». **هذا غير صحيح للملف الحالي.** فحص `.github/workflows/ci.yml` في هذه
المرحلة أظهر مهمّة `integration` كاملة: خدمة `postgis/postgis:17-3.5`، وإنشاء أدوار
`anon`/`authenticated`/`service_role`، وتطبيق الهجرات بالترتيب، وتشغيل `test:integration`
و`test:e2e`، بل وخطوتان تمنعان التخطّي الصامت عبر `grep` على كلمة «مُتخطّاة». أسحب الادعاء
السابق. الحارس الجديد سيعمل في هذه المهمّة تلقائياً بلا تعديل على CI.

---

## ٧) المخاطر المتبقية (لم تُصلَح في هذه المرحلة — بقصد)

| # | الخطر | الشدّة | المحلّ |
|---|---|---|---|
| R-1 | **لا فرض لـTLS على اتصال قاعدة البيانات.** `createSql()` لا يمرّر `ssl` إلى `postgres()`، والتحقق من `DATABASE_URL` يفحص البادئة فقط ولا يشترط `sslmode=require`. بيانات شخصية ومواقع قد تسير بلا تعمية. **غير مُثبَت** أثره الفعلي: يعتمد على ما إذا كان مضيف Supabase يفرض TLS من طرفه، وهو ما لا أستطيع قياسه محلياً | P0 | المرحلة ١٨ — يُقاس على الرابط الحقيقي ثم يُفرض |
| R-2 | **ويبهوك الدفع يوقّع بسرّ ثابت في ترويسة، لا بـHMAC على الجسم.** فلا سلامة لكل رسالة ولا منع لإعادة الإرسال. وكذلك `await c.req.text()` يحمّل الجسم كاملاً **قبل** فحص الحجم، فحدّ الـ256KiB تجميلي (بخلاف مسار تلغرام الذي يقرأ محدوداً بالبثّ). ولا حدّ نداءات على المسار، أي تخمين غير محدود للسرّ | P1 | المرحلة ١٩ — المسار يُغلق كلّه (الدفع خارج النطاق) |
| R-3 | **منع تكرار التحديث داخل العملية.** `createUpdateDeduplicator()` في الذاكرة؛ مع أكثر من نسخة gateway يُعالَج التحديث مرتين. كامن حالياً لأن `render.yaml` يثبّت `numInstances: 1` | P1 | المرحلة ٢٠ |
| R-4 | `search_path=public` على الدوال الـ٤٩ بدل `pg_temp` صريح أو `''` | P2 | المرحلة ١٨ |
| R-5 | الهجرة تُحكم الدوال **الموجودة** فقط. لا آلية تلقائية تمنع ولادة الدالة القادمة مفتوحة (البرهان في P0-B). الضمانة الوحيدة هي الحارس في CI | P1 مقبول | مُدار بالاختبار |

**لا شيء ممّا سبق يمنع إغلاق بوابة المرحلة ١**: R-1 محلّه تدقيق قاعدة البيانات بالرابط
الحقيقي، وR-2 محلّه إغلاق مسار خارج النطاق، وR-3/R-4 دون عتبة الإطلاق.

---

## ٨) لا عيوب وُجدت في

- **XSS:** `escapeHtml()` في `layout.ts:24` يغطّي `& < > " '`، و`escapeText()` في
  `SEARCH_SCRIPT` يعمّي النص قبل `innerHTML`. لا مسار غير معمّى.
- **حقن SQL:** مواضع `sql.unsafe` الستة (`negotiation-adapters.ts:245,258,268`,
  `order-adapters.ts:62`, `directories.ts:62,210`) بادئاتها ثابتة والقيم مربوطة بـ`$1`.
- **تنفيذ تعسّفي:** لا `eval` ولا `new Function` ولا `child_process` في المستودع.
- **تسريب أسرار:** لا سرّ في أي سطر تسجيل.

---

## ٩) بوابة المرحلة ١ — الحكم

| الشرط | الحالة | الدليل |
|---|---|---|
| كل جدول عليه RLS نافذ | ✅ | الحارس، الطبقة ١ |
| لا دالة قابلة للنداء من `anon` | ✅ | الحارس، الطبقة ٢ |
| القفل الجامع صامد | ✅ | الحارس، الطبقة ٣ |
| سرّ الويبهوك بحدّ أدنى مفروض | ✅ | ٤ اختبارات وحدة |
| لا XSS / حقن SQL / تنفيذ تعسّفي | ✅ | فحص شامل، §٨ |
| حارس يمنع الانتكاس | ✅ | يعمل في مهمّة `integration` في CI |
| typecheck / lint الملفات المتغيّرة | ✅ | صفر / نظيف |
| لا انتكاس في الحزمة | ✅ | 1052 pass، والفشل الوحيد مقصود ومسجَّل |

**البوابة: مغلقة.** المرحلة التالية: **٢ — أمن التتبّع**.

---

## ملحق: كيف يُعاد إنتاج كل رقم هنا

```bash
export PATH="$HOME/.bun/bin:$PATH"
export TEST_DATABASE_URL="postgres://postgres:<pw>@127.0.0.1:5432/waslah_test"
cd repo && bun test tests/integration/database-privilege-surface.test.ts
```

وللقياس المباشر من القاعدة بلا اختبار:

```sql
-- الطبقة ١
select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relrowsecurity=false;

-- الطبقة ٢
select p.oid::regprocedure, has_function_privilege('anon', p.oid, 'EXECUTE')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and not exists (
  select 1 from pg_depend d where d.objid=p.oid and d.classid='pg_proc'::regclass and d.deptype='e');

-- الطبقة ٣
select has_schema_privilege('anon','public','USAGE');
```
