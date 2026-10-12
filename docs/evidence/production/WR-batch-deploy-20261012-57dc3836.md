# نشر دفعة 2026-10-12 (`3c122d1a` ثم `57dc3836`)

**القاعدة:** مشروع Supabase الإنتاجي `jafuchojgxzeuvibkkfx`.
**الخدمات:** Render workspace `tea-daomodrbc2fs7382qk2g`، والخدمتان `autoDeploy: no` (مقروء من Render قبل النشر).
القيم أدناه مقروءة من Render والقاعدة والحزمة المنشورة نفسها، لا من CI.

## 1. ما دُمج

| PR | البند | الدمج في `main` |
|---|---|---|
| #518 | — | `5859c0a7` |
| #513 | WR-06 | `5c982e51` |
| #514 | WR-16D | `629f6333` |
| #516 | WR-16A | `6d2b4650` |
| #517 | WR-16B | `ae7ee76c` |
| #519 | WR-22 · WR-09 | `3c122d1a` |
| #520 | WR-08 · WR-19 | `57dc3836` |

## 2. القاعدة

### 2.1 هجرة WR-22 (`20261012190000_wr_22_cancel_releases_candidate.sql`)

- **نسخة احتياطية قبلها:** `wasla-backup-20261012T064442Z.tar.age`.
  - `verified`: 5183 صفًا في المصدر و5183 بعد الاستعادة، في 96 جدولًا، و`problems = []`.
  - التشغيل: [ceezr-backups run 38213772386](https://github.com/uxxxug/ceezr-backups/actions/runs/38213772386).
- قبل التطبيق: `md5(prosrc)` لـ`cancel_order_by_rider` = `83bc47b5785dd7fb0919715ef9ea7cef`، وهو المتوقع.
- بعد التطبيق:
  - `cancel_order_by_rider` = `ca1dea5ceeb955df3c745a75d2572dca`، ويطابق قاعدة محلية مبنية من `main` بالسلسلة كاملة.
  - `release_order_candidate` = `5aba078f…` بلا تغيير.
- الصف في `schema_migrations`: `20261012064753`.

### 2.2 هجرتا WR-08 (`20261012200000` و`20261012200100`)

- **نسخة احتياطية قبلهما:** `wasla-backup-20261012T070041Z.tar.age`.
  - `verified`: 5184/5184 صفًا، في 96 جدولًا، و`problems = []`.
  - التشغيل: [ceezr-backups run 38215151701](https://github.com/uxxxug/ceezr-backups/actions/runs/38215151701).
- قبل التطبيق:
  - في `notification_outbox` 7 صفوف `offer`: 4 مسلّمة وعرضها مقبول، و2 مسلّمة وعرضها منتهٍ، و1 `dead` وعرضه مقبول. لا عرض `pending`.
  - `claim_notification_delivery` = `b155fbfab0276c44970e1cb320afbcb1`.
- بعد التطبيق:
  - الصفوف السبعة كلها `offer_card_closed_at` غير فارغ، و`offer_card_close_attempts` أقصاه 0، أي لم تُعدَّل أي رسالة لسائق حقيقي.
  - `claim_notification_delivery` = `005e4e321578179999bc14d3f4a0e167`، ويطابق القاعدة المحلية.
  - صلاحية التنفيذ: `service_role` وحده، لا `anon` ولا `authenticated`.
- الصفان في `schema_migrations`: `20261012070224` و`20261012070240`.

## 3. النشر

| الخدمة | النشر | الإيداع الحي | الانتهاء |
|---|---|---|---|
| `waslah-gateway` | `dep-db685it9fdbs73f68sd0` | `3c122d1a` | 06:49:34Z |
| `waslah-miniapp` | `dep-db685j942hec73b99dhg` | `3c122d1a` | 06:49:05Z |
| `waslah-gateway` | `dep-db68c8vlot8c7398nbc0` | `57dc3836` | 07:03:57Z |
| `waslah-miniapp` | `dep-db68c93bc2fs73b6pirg` | `57dc3836` | 07:03:19Z |

## 4. التحقق بعد النشر

| الفحص | النتيجة |
|---|---|
| `/ready` على البوابة | `ready`، و`missingEnv`/`failedChecks`/`degradedChecks` فارغة |
| شوط `expire-offers:<city>` | `job.ran` في 07:06:10Z و07:06:18Z بـ`examined=0 expired=0 cardsClosed=0 cardsFailed=0`، أي أن خطوة WR-08 تعمل |
| سجل البوابة بعد 07:04Z (`warn`/`error`) | صفر |
| حزمة Mini App المنشورة | `driver-D4pB_LHK.js` تحمل `driver.offers.refresh.*` (WR-16A) و`driver.offers.pickupAt.at` (WR-06)، و`rider-destination-TCAPNawv.js` تحمل `rider.destination.location.replaceAsk` (WR-16D)، و`rider-views-DQ5LySm5.js` تحمل `rider.search.error.pickupAt` (WR-06)، و`rider-quote-AhPkGZQ3.js` تحمل `rider.quote.pickup.timeRequired` |

## 5. ما لم يُتحقق منه

- لم يُنشأ طلب في الإنتاج بعد النشر (0 طلبات نشطة)، فكل ما سبق **منشور لكنه لم يُمارَس في الإنتاج**. وهذا يشمل:
  - إغلاق بطاقة العرض الميت.
  - ظهور الخدمة واسم المكان على البطاقة.
  - تحرير المرشّح عند الإلغاء.
- لم يُنشأ طلب اختباري عمدًا، فأمر التنفيذ يمنع الطلبات الإنتاجية والرسائل إلى سائقين حقيقيين لأغراض الاختبار.
- تيليجرام الفعلي (البطاقة على هاتف السائق، وشريط التنقل فوق المنطقة الآمنة على جهاز حقيقي) يحتاج حسابات وأجهزة اختبار (WR-26).
