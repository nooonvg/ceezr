# البند 2.3 والبند 3 — تشخيص على القاعدة الحيّة ثم إصلاح جذر

منهج هذا المستند نفس منهج `docs/archive/reports-2026-08-09/directive-final-baseline.md`: لا تصنيف بالنظر، ولا اعتماد على
تعليق يقول «منفّذ». كل سطر أدناه إمّا نتيجة استعلام على قاعدة الإنتاج، أو نتيجة اختبار شُغِّل فعلاً.

---

## 1. الحالة المرصودة على قاعدة الإنتاج

استعلام واحد على `gczgllrulsqubkyehzep` (جدول `drivers` مع `driver_availability` و`users`
و`driver_capabilities` و`subscriptions`) أعاد سطراً واحداً — السائق الوحيد في النظام:

| الحقل | القيمة |
|---|---|
| `id` | `7e736f9d-d91e-4bf9-abdb-2e31899183c0` |
| المدينة | `JED` |
| `verification_status` | `verified` |
| `users.is_blocked` | `false` |
| `driver_availability.is_available` | **`true`** (تغيّر في `2026-08-11 05:38:45+00`) |
| `driver_capabilities` المفعّلة | `transport` |
| `subscriptions.status` | `trialing` |
| `last_location` | **`NULL`** |
| `last_location_at` | `NULL` |
| `vehicle_type` / `plate_number` | `NULL` |

عدد أسطر `order_offers` لهذا السائق: **صفر**. وعدد أسباب الرفض الظاهرة له: **صفر أيضاً**.

## 2. التشخيص بالترتيب الصارم الذي أمر به التوجيه

الوقوف عند أول سبب حقيقي، لا تجاوزه:

| # | الفحص | النتيجة | حكم |
|---|---|---|---|
| 1 | كتابة `is_available` | `true` في القاعدة، بوقت تغيير حقيقي، والمسار الوحيد للكتابة هو RPC `record_attendance` من `directories.ts:setAvailability` وهي ترمي إن لم يكن `ok = true` | **سليم — ليس السبب** |
| 2 | `verification_status` | `verified` | **سليم — ليس السبب** |
| 3 | `driver_capabilities` مقابل `service_type` | القدرة `transport` والطلب `transport` — متوافقان. والفصل بين الجدولين مقصود لا عطب، كما نصّ التوجيه | **سليم — ليس السبب** |
| 4 | تطابق `city_id` | السائق `JED` والطلبات `JED` — متطابقان. و`CITY_MISMATCH` مقصود لا عطب | **سليم — ليس السبب** |
| 5 | `broadcastOffers` والمهمّة الدورية | **هنا وُجد السبب** — وتفصيله أدناه | **السبب الحقيقي** |

### السبب الحقيقي

في `packages/infrastructure/dispatch/dispatch-adapters.ts`، استعلام `findAvailableInCity`
كان ينتهي بـ:

```sql
where d.city_id = ${cityId}
  and d.last_location is not null      -- ← هنا
```

فالسائق بلا موقع **يختفي قبل أن يراه الدومين**. وأثر ذلك مزدوج، والثاني أخطر من الأول:

1. لا يُسنَد إليه شيء — وهذا صحيح ومطلوب: لا يمكن حساب مسافة من موقع غير موجود.
2. **ولا يُسمّى سببه لأحد.** `evaluateCandidates` تُعيد `{eligible, rejected}`، و`rejected`
   تخرج فارغة لأن المرشّح لم يصل إليها أصلاً. ثم `matchOrder` تُرجع
   `NoEligibleDriverError(orderId, evaluation)` وفيها `rejected` فارغة. فالجواب على سؤال
   «لماذا لا تصل الطلبات السائقين؟» هو حرفياً «لا مرشّحين، ولا سبب» — لا للمشغّل، ولا في
   السجلّ، ولا في لوحة الإدارة.

وكان في المحوّل عطب ثانٍ مستقلّ: `location: { latitude: Number(row.lat ?? 0), longitude: Number(row.lng ?? 0) }`.
لو رُفع شرط SQL وحده لصار السائق بلا موقع يُحسَب من الإحداثية `(0,0)` — نقطة حقيقية في
المحيط الأطلسي — فيُرَدّ بسبب `OUT_OF_RADIUS`، فيطارد المشغّل نصف القطر بلا فائدة. الغياب
يُمثَّل غياباً لا صفراً.

### قياس أثر السبب على بيانات الإنتاج

استعلام مقارنة على قاعدة الإنتاج لمدينة جدة:

```
candidates_before_fix = 0     -- الاستعلام القديم بشرط last_location is not null
candidates_after_fix  = 1     -- الاستعلام الجديد
```

## 3. الإصلاح

الإصلاح في طبقة القرار لا في القاعدة — وهي نفس العلّة التي من أجلها نُقل `is_blocked` من
SQL إلى الدومين سابقاً (انظر `tests/integration/blocking-enforcement.test.ts`):

1. `packages/domain/dispatch/entity.ts`
   - `DriverCandidate.location` صار `Coordinates | null`.
   - سبب رفض جديد `NO_LOCATION` في `RejectionReason`.
   - `rejectionReasonFor`: يُفحَص بعد `NOT_AVAILABLE` وقبل `SERVICE_NOT_ENABLED`. الموضع
     مقصود: فحص `null` أرخص من فحص القدرات، ولأنّ سائقاً ينقصه الموقع فقط لا يُقال له إنّ
     خدمته غير مُفعّلة فيفتّش في مكان خاطئ. و`NOT_AVAILABLE` تبقى فوقه: غير المتاح لا
     يُطالَب بموقعه أصلاً.
   - `evaluateCandidates`: التضييق النوعي بشرط صريح لا بـ`as`، حتى لا يمرّ أي تغيير مستقبلي
     في ترتيب الأسباب صامتاً ثم يُحسَب من `(0,0)`.
2. `packages/infrastructure/dispatch/dispatch-adapters.ts`
   - حُذف `and d.last_location is not null`.
   - `location` يُمرَّر `null` عند غياب `lat`/`lng` بدل `?? 0`.
3. `packages/application/dispatch/broadcast-offers.ts`
   - حقل `log?` اختياري (نفس النمط المتَّبع في `sweep-unmatched-orders.ts` و`telegram-webhook.ts`)،
     ودالة `logIneligibility` تُخرج `dispatch.no_eligible_driver` مع **تعداد** الأسباب.
   - التعداد لا القائمة الكاملة: مدينة بمائة سائق تملأ السجلّ بلا فائدة، والمشغّل يحتاج أن
     يعرف «أربعة بلا موقع» لا معرّفاتهم الأربعة؛ المعرّفات تُرى في لوحة الإدارة.
   - بلا هذه الخطوة يبقى الإصلاح غير مرئيّ: منادي بوت العميل في `rider-dialog.ts:715` يُسقط
     الخطأ بـ`if (!broadcast.ok) return replies`.
4. `apps/gateway/src/container.ts` — يُمرَّر `log` إلى تبعيات المطابقة ليصل السجلّ إلى الإنتاج.

**لم يُنشَأ عمود ولا جدول ولا هجرة.** العطب كان في طبقة القرار وحدها.

## 4. البند 3 — مصدر واحد لحالة التوثيق: مُثبَت، ولا عطب

تتبُّع المسارين كاملاً:

- **الكتابة:** `POST /admin/drivers/:id/verification` في `apps/gateway/src/routes/admin-ui.ts:578`
  → `setDriverVerification` في `admin/queries.ts:1197` → RPC `admin_set_driver_verification`
  (`supabase/migrations/20260808140000_phase_2_7_admin_dashboard.sql:378`) →
  `update drivers set verification_status = p_status::verification_status`.
- **القراءة في المطابقة:** `dispatch-adapters.ts:110` تقرأ `d.verification_status`، والسطر 82
  يحوّلها `isVerified: row.verification_status === "verified"`.
- **القراءة في بوت السائق:** `identity/directories.ts:51` تقرأ نفس العمود بنفس التحويل.
- **القراءة في لوحة الإدارة:** `admin/queries.ts` أسطر 145 و404 و416 و429 — نفس العمود.

وللتأكّد أنّ لا مصدر ثانٍ خفيّ، استعلام على `information_schema.columns` لكل الأعمدة التي
يشبه اسمها التوثيق في المخطَّط `public` أعاد **سطراً واحداً فقط**:
`drivers.verification_status` من نوع مُعرَّف (enum `verification_status`).

**الحكم: مصدر واحد للحقيقة، وافتراض التوجيه بوجود انقسام غير صحيح. لا إصلاح مطلوب.**
وبدل الاكتفاء بهذا الاستدلال، `tests/integration/driver-location-visibility.test.ts` يُثبته على
قاعدة حقيقية: يوثّق السائق بالدالة الذرّية نفسها (لا `update` مباشر)، ثم يقرأ بمستودع
المرشّحين نفسه الذي تستعمله `matchOrder`، ويؤكّد `isVerified === true` ثم وصول العرض فعلاً.

كما لوحظ أثناء القراءة أنّ `admin_set_driver_verification` تُنزل `is_available = false` عند أي
حالة غير `verified` — فالسائق المعلَّق لا يبقى مرشَّحاً بعد لحظة من تعليقه. سلوك سليم، مُوثَّق
هنا لأنه لم يكن مذكوراً في أي مستند.

## 5. الاختبارات المُشغَّلة فعلاً

جديد في `tests/unit/dispatch-matching.test.ts` (يعمل بلا قاعدة — شُغِّل ونجح):

- `يسمّي NO_LOCATION لمن هو موثّق ومتاح ومشترك ولم يرسل موقعاً قطّ` — يعيد إنتاج حالة
  الإنتاج بحرفها، ويؤكّد قبلها أنّ `isVerified` و`isAvailable` و`subscription` كلها سليمة،
  فلا يُنسب الفشل إلى سبب آخر.
- `NO_LOCATION يُقدّم على SERVICE_NOT_ENABLED عند تحقّق السببين`.
- `NOT_AVAILABLE يُقدّم على NO_LOCATION`.
- `يُبلِغ عن السائق بلا موقع بدل أن يختفي صامتاً` — `eligible = 0` **و** `rejected` فيها سببه.
- `لا يحسب مسافة من (0,0) لمن لا موقع له` — يمنع عودة عطب `?? 0`.

جديد في `tests/unit/broadcast-offers.test.ts` (شُغِّل ونجح):

- `يُخرج تعداد أسباب الرفض إلى السجلّ — لا يدفنها في الخطأ` (بسببين مختلفين ليُثبت أن
  التعداد يفصل ولا يجمع).
- `لا يسجّل شيئاً عند نجاح البثّ`.
- `يعمل بلا سجلّ مطلقاً: الحقل اختياري ولا يُسقط البثّ`.

جديد `tests/integration/driver-location-visibility.test.ts` (يتطلّب `TEST_DATABASE_URL`، فيُتخطّى
في هذه البيئة كبقيّة اختبارات التكامل الـ218):

- خطّ أساس: التوثيق بالدالة الذرّية وحده يكفي لوصول العرض — إثبات البند 3 على قاعدة حقيقية.
- السائق المتاح بلا موقع لا يصله عرض، مع تأكيد صريح أن حالة القاعدة `has_location = false`
  و`is_available = true` — أي أن حالة الإنتاج أُعيد إنتاجها لا حُوكِيت.
- ظهوره في المرشّحين بـ`location = null` ثم في `rejected` بـ`NO_LOCATION`، والإعدادات مقروءة
  من `platform_settings` بمستودع الإنتاج ومحلّله — لا قيمة تجارية مكتوبة في الاختبار.
- إرسال الموقع بعده يُنهي الاستبعاد فوراً: نفس السائق يصله عرض، بلا إعادة تسجيل ولا تبديل توافر.

### نتيجة التشغيل

```
bun run typecheck   → نظيف
bun run lint        → 0 أخطاء، 9 "infos" سابقة للتوجيه (useLiteralKeys في agent-core)
bun test            → 654 pass / 218 skip / 0 fail / 1838 expect() / 872 tests / 61 files
```

خطّ الأساس قبل هذه المرحلة كان `646 pass / 212 skip / 0 fail / 1820 expect()`.

## 6. ما لم يُصلَح هنا وسببه

- `vehicle_type` و`plate_number` فارغان لهذا السائق رغم أن تسجيل السائق يطلبهما. الأرجح أن
  السطر أُنشئ بمسار تسجيل أقدم من هجرة `20260811080000_driver_kyc_profile`. لا يُصلَح بكود:
  بيانات سطر واحد قديم، وسيُحسَم في البند 9 بتسجيل سائق جديد كاملاً من الصفر.
- الطلبات العالقة الثلاثة إحداثيات انطلاقها في المدينة المنورة و`city_id` فيها جدة (نتيجة
  البند 0، القسم 0.6). لا علاقة لها بهذا الإصلاح: مسافة نحو 350 كم مقابل `search_radius_km = 10`
  تعني `OUT_OF_RADIUS` بحق. والآن يظهر هذا السبب في السجلّ بدل الصمت.
