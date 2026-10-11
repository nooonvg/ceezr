# متطلّبات التشغيل

> ما يجب أن يكون **موجوداً قبل** أوّل هجرة. كل بند هنا وقع فعلاً أثناء إعداد
> بيئة اختبار من الصفر وأسقطها؛ فليس تحوّطاً نظرياً.

---

## 1) قاعدة البيانات

### امتداد `postgis` — **إلزامي**

أوّل هجرة (`20260806120000_phase_2_1_core_schema.sql:11`) تنفّذ
`create extension if not exists postgis;`. فبلا الامتداد **متاحاً للتثبيت**
تسقط الهجرة الأولى ولا يُبنى شيء.

- **Supabase:** متاح ويُفعَّل تلقائياً بالسطر أعلاه. لا إجراء.
- **Postgres عادي:** يجب تثبيت حزمة النظام أولاً (مثل `postgresql-18-postgis-3`).
  `create extension` وحده لا يُنزِّل الحزمة.

### الأدوار الثلاثة — **إلزامية، ولا تُنشِئها الهجرات**

الهجرات تنفّذ `revoke ... from anon, authenticated` و`grant ... to service_role`.
و`revoke` على دور غير موجود **يسقط** بخطأ. فوجودها شرط، لا نتيجة.

| الدور | الغرض |
|---|---|
| `anon` | غير مصادَق. تُنزع كل صلاحياته عن كل جدول ودالّة |
| `authenticated` | مصادَق عبر Supabase Auth. تُنزع صلاحياته كذلك |
| `service_role` | **الدور الذي يعمل به التطبيق.** يتجاوز RLS |

> النزع من `anon` و`authenticated` مقصود: PostgREST مُغلَق كلياً
> (هجرتا `20260809000000` و`20260809001000`). لا وصول خارجياً إلى الجداول؛
> كل تعامل عبر البوّابة أو الدوال الذرّية.

على Supabase الثلاثة موجودة سلفاً. على Postgres عادي أنشئها **قبل** الهجرات:

```sql
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
```

`bypassrls` على `service_role` ضروري: بدونه تحجب سياسات RLS التطبيقَ عن بياناته.

### ترتيب الهجرات

تُطبَّق **بترتيب اسم الملفّ** لا بترتيب عشوائي:

```bash
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$f"
done
```

`ON_ERROR_STOP=1` إلزامي، وإلا مضى `psql` بعد فشل هجرة وترك القاعدة نصف مبنيّة.

**البناء النظيف (مُحدَّث ومتحقَّق منه 2026-08-13) = 34 هجرة ⇒ 25 جدولاً أساسياً للمشروع + 2 مناظر (`agent_effectiveness`، `v_latest_backup`).**

تنبيه عند العدّ: PostGIS يُضيف إلى مخطط `public` جدولاً واحداً من عنده (`spatial_ref_sys`)
ومنظرَين (`geometry_columns`، `geography_columns`)، فإن عددت بلا استبعاد رأيت 26 جدولاً و٤ مناظر.
و`spatial_ref_sys` جدول نظام لا يحمل `city_id` ولا يجوز أن يحمله، ولذلك تقول بوابة
`bun scripts/check-migrations.ts` بحق «25 جدولاً كلها تحمل city_id وRLS». أمر التحقّق المستعمل:

```bash
psql "$DATABASE_URL" -tAc "select count(*) from information_schema.tables
  where table_schema='public' and table_type='BASE TABLE' and table_name<>'spatial_ref_sys'"
```
رسائل `NOTICE` عن مُشغِّلات غير موجودة متوقَّعة وغير ضارّة.
للتحقّق: `bun scripts/check-migrations.ts`.

---

## 2) البيئة

`REQUIRED_ENV_KEYS` تسعة، وغياب أيٍّ منها يُبقي `/ready` على 503 إلى الأبد:

`SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `DATABASE_URL` ·
`UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` · `DRIVER_BOT_TOKEN` ·
`RIDER_BOT_TOKEN` · `TELEGRAM_WEBHOOK_SECRET` · `BOOTSTRAP_ADMIN_TELEGRAM_ID`

> ⚠️ **مصيدة نشر موثَّقة:** `UPSTASH_*` مطلوبان **حتى مع `SESSION_STORE=memory`**
> حيث لا يُستعمل Redis أصلاً. فتركهما فارغين يعني 503 دائماً بلا سبب ظاهر.
> ضع قيمتين نائبتين غير فارغتين. التفصيل في
> [`render-deployment-vars.md`](./render-deployment-vars.md).

`AGENT_CORE_ENABLED` **غائب عمداً** من `render.yaml` ⇒ agent-core مُعطَّل في
الإنتاج. هذا هو الوضع الصحيح (ADR 0012): يبقى ضمن «اقترح لا تنفّذ».

---

## 3) التشغيل المحلّي

```bash
bun install
export PATH="$HOME/.bun/bin:$PATH"

export TEST_DATABASE_URL="postgres://postgres@127.0.0.1:5432/waslah_test"
export DATABASE_URL="$TEST_DATABASE_URL"

bun run typecheck && bun run lint
bun test                    # 1498 اختباراً في 104 ملفات (متحقَّق منه 2026-08-13)
bun run test:integration
bun run test:e2e            # 30 رحلة متتابعة — يتطلّب TEST_DATABASE_URL
```

**البوّابات الأربع** (تُشغَّل في CI ويجب أن تمرّ قبل أي دفع):

```bash
bun scripts/check-agent-core-isolation.ts   # عزل agent-core
bun scripts/check-business-constants.ts     # لا قيم تجارية مرمَّزة
bun scripts/check-i18n.ts                   # لا نصّ بلا ترجمة
bun scripts/check-migrations.ts             # سلامة الهجرات
```

> اختبارات التكامل و e2e **تتخطّى نفسها بصمت** بلا `TEST_DATABASE_URL`.
> لذا في CI حارسٌ يفشل إن ظهرت رسالة التخطّي — وإلا بدا الأخضر نجاحاً وهو غياب.

**أدوات تشخيص يدوية** (ليست ضمن `bun test`):

```bash
python3 scripts/audit-plpgsql.py                 # تمشيط «افحص ثم اكتب» بلا قفل
bun scripts/race-login-code.ts [جولات] [تزامن]
bun scripts/race-support-ticket.ts [جولات] [تزامن]
```

---

## 4) ثغرات مفتوحة برسم المالك

| البند | الحالة |
|---|---|
| سقف تجمّع الاتّصالات | `max: 5` افتراضاً في `createSql`. **غير مضبوط للإنتاج** |
| سياسة النسخ الاحتياطي | **غير موثّقة.** لا جدول ولا اختبار استرجاع |
| حارس داخل حزمة الاختبار للسباقين المُصلَحين | لا يوجد؛ الحماية عبر السكربتين اليدويين فقط ([التفصيل](archive/reports-2026-08-09/directive-final-section-7-plpgsql-audit.md#5)) |
| إزالة تكرار `update_id` | غير منفّذة. تلغرام قد يعيد إرسال التحديث نفسه |
