# المرحلة 2.1 — الخطوة 1: تقرير الإنجاز

**الحالة: منتهية ومتحقَّق منها على قاعدة PostgreSQL حقيقية.**

قاعدة البيانات: مشروع Supabase `agent-control-center` (`jtxpnsrzmlqeqfbvtnxu`)، PostgreSQL 17.6، منطقة `ap-northeast-1`.
كان مخطط `public` فارغاً تماماً قبل التطبيق، فلا تعارض مع أي شيء قائم.

---

## ما طُبِّق فعلياً

### ثلاث هجرات (migrations) نُفِّذت بنجاح
| الملف | المحتوى |
|---|---|
| `20260806120000_phase_2_1_core_schema.sql` | 12 جدولاً + 7 أنواع معدودة + فهارس + محفّزات + RLS |
| `20260806120100_phase_2_1_atomic_rpcs.sql` | 7 دوال قاعدة بيانات، منها 5 عمليات حرجة ذرّية |
| `20260806120200_phase_2_1_seed_cities_and_settings.sql` | المدن الأربع + 52 صف إعدادات |

### الجداول الاثنا عشر
`cities` · `platform_settings` · `users` · `drivers` · `riders` · `driver_capabilities` ·
`subscriptions` · `driver_availability` · `attendance_log` · `orders` · `order_offers` · `audit_log`

### الدوال
| الدالة | الذرّية |
|---|---|
| `claim_ride(order_id, driver_id)` | `SELECT … FOR UPDATE SKIP LOCKED` على الطلب + قفل العرض |
| `record_attendance(driver_id, is_available, source)` | قفل السائق + تحديث الحالة + سجل + audit في معاملة واحدة |
| `start_trial(driver_id, plan)` | قفل السائق + منع تكرار الشهر المجاني |
| `activate_subscription(driver_id, plan, days)` | قفل السائق + السعر من `platform_settings` لا من الكود |
| `expire_stale_offers()` | تنتهي منها مهمة Cron |
| `get_setting` / `get_setting_number` | المصدر الوحيد لأي قيمة تجارية |

---

## التحقق الآلي — نتائج فعلية من القاعدة

| الفحص | النتيجة |
|---|---|
| عدد الجداول التي تحمل `city_id` | **12 من 12** (الجدول الثالث عشر هو `spatial_ref_sys` التابع لـ PostGIS، ليس ملكاً للمشروع) |
| جداول بلا RLS | **صفر** من جداول المشروع |
| امتداد PostGIS | مفعَّل |
| المدن المبذورة | 4 |
| صفوف الإعدادات | 52 (13 مفتاحاً × 4 مدن) |
| الدوال المنشأة | 7 من 7 |

### اختبار وظيفي حقيقي (نُفِّذ على القاعدة ثم نُظِّفت بياناته بالكامل)
| السيناريو | المتوقَّع | الناتج الفعلي |
|---|---|---|
| 5 سائقين يستدعون `claim_ride` على نفس الطلب | فائز واحد | ✅ السائق 1 فاز، والأربعة الباقون `ORDER_NOT_CLAIMABLE` |
| عروض مقبولة | 1 | ✅ 1 |
| عروض مُلغاة تلقائياً | 4 | ✅ 4 |
| سائق من مكة يحاول قبول طلب في جدة | رفض | ✅ `CITY_MISMATCH` |
| `start_trial` مرتين لنفس السائق | رفض الثانية | ✅ `TRIAL_ALREADY_USED` |
| تبديل الحضور يُسجَّل | صف في `attendance_log` | ✅ 1 |
| `claim_ride` يكتب في `audit_log` | صف | ✅ 1 |

القاعدة الآن نظيفة: صفر مستخدمين، صفر سائقين، صفر طلبات، صفر صفوف تدقيق.

---

## قيود مقصودة مبنية داخل المخطط

1. **`cities_active_requires_groups`**: لا يمكن تفعيل أي مدينة (`is_active = true`) قبل ربط معرّفات قروباتها الثلاثة. المدن الأربع الآن `is_active = false` لأن المعرّفات الاثني عشر لم تُسلَّم بعد.
2. **`subscriptions_one_live_per_driver`**: فهرس فريد جزئي يمنع وجود اشتراكين فعّالين لسائق واحد.
3. **`order_offers_single_accepted`**: فهرس فريد جزئي — حاجز أخير فوق ذرّية `claim_ride`، يجعل تعدد الفائزين مستحيلاً على مستوى القاعدة لا على مستوى المنطق.
4. **`orders_matched_requires_driver`**: طلب في حالة `matched`/`in_progress`/`completed` بلا سائق مُسنَد = مرفوض.
5. **`cities.city_id`** عمود مولَّد يساوي `id`، حتى لا يُستثنى جدول واحد من القاعدة 0.4.
6. **الصلاحيات**: كل الجداول والدوال محجوبة عن `anon` و `authenticated`. الوصول في 2.1 من الخادم بمفتاح `service_role` حصراً.

---

## 20 إعداداً مبدئياً ينتظر مراجعتك

بذرت القيم غير المحسومة بعلامة `is_provisional = true` (5 مفاتيح × 4 مدن) حتى تُميَّز عن القيم التي أمرتَ بها أنت:

| المفتاح | القيمة المبدئية |
|---|---|
| `search_radius_km` | 10 |
| `max_broadcast_rounds` | 3 |
| `match_weight_proximity` | 0.7 |
| `match_weight_rating` | 0.3 |
| `default_rating_for_new_driver` | 4.5 |

تعديل أي منها = `UPDATE` على صف واحد، بلا نشر كود.

```sql
select key, value, is_provisional from platform_settings
where city_id = (select id from cities where code = 'JED') order by key;
```

---

## ما يمنع الانتقال للخطوة 2

| الحاجز | المطلوب منك |
|---|---|
| المدن الأربع كلها `is_active = false` | 12 معرّف قروب تيليجرام (3 لكل مدينة) |
| لا اتصال من التطبيق بعد | مفاتيح Upstash Redis |
| لا بوتات | توكنا البوتين + سرّ Webhook |

الخطوة 2 (وصل `packages/shared` بـ Supabase و Redis فعلياً) تحتاج مفاتيح Redis. أما مفاتيح Supabase فمتوفّرة من المشروع أعلاه.
