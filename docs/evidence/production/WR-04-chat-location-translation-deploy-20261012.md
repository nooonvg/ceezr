# WR-04 — نشر رسالة الموقع وترجمة المحادثة (ADR 0274) على الإنتاج — 2026-10-12

**الحالة:** الهجرتان `20261013000500` و`20261013000600` مطبّقتان على قاعدة الإنتاج (`jafuchojgxzeuvibkkfx`)، والبوابة وMini App منشورتان بالنسخة `23e74d9c` (دمج #531) ومتحقَّق منهما من الخارج. **الترجمة معطّلة في الإنتاج** (`TRANSLATION_PROVIDER=none`). **لم يُجرَ اختبار الطرفين على تيليجرام ولا على جهاز.**

## التسلسل

| # | الخطوة | النتيجة |
|---|---|---|
| 1 | فحص مسبق: لا طلب نشط (`completed` 5، `cancelled` 1)، و`order_messages` فيه 0 صف | لا محادثة جارية تتأثر |
| 2 | فحص مسبق: `md5(prosrc)` لـ`order_chat_party` و`enqueue_order_chat_notice` و`refresh_admin_metric_snapshots` في الإنتاج يطابق المحلية المبنية من المستودع | مطابق، فلا تغيير حيّ يُفقَد |
| 3 | نسخة احتياطية جديدة قبل التطبيق: `nightly-backup` تشغيل `38282554832` (17:11Z)، الملف `wasla-backup-20261012T171415Z.tar.age`، `restore_verification_status = verified` على PostgreSQL 17 مؤقتة، وإعادة تنزيل وتحقق sha256 | ناجح. **بايتات Storage غير مشمولة** (`storage.status = not_configured`)، والحاوية `driver-documents` فيها 0 كائن، والتغيير لا يمس Storage |
| 4 | `20261013000500_wr_04_chat_location_kind.sql` حرفيًا عبر `apply_migration` | `success` |
| 5 | `20261013000600_wr_04_chat_location_kind_validate.sql` | `success` |
| 6 | مطابقة `md5(prosrc)` للدوال الخمس، و`convalidated` للقيود الأربعة، مع قاعدة محلية طُبّقت عليها السلسلة كاملة | **5/5 و4/4 مطابقة** (أدناه) |
| 7 | الصلاحيات: `post_order_message_kind` ينفّذها `service_role` وحده، و`anon`/`authenticated` لا | مطابق |
| 8 | نشر البوابة `srv-dat37gou01pc739pgnc0` بالنشر `dep-db6hbfjl550s73at6qg0` | `live` على `23e74d9c` (17:16:34Z) |
| 9 | نشر Mini App `srv-dat383bncjis73cukcpg` بالنشر `dep-db6hbg0n74is73a0dr3g` | `live` على `23e74d9c` (17:16:03Z) |
| 10 | `GET /ready` | `ready`، بلا متغيرات ناقصة ولا فحوص فاشلة ولا متدهورة |
| 11 | `GET /v1/orders/<uuid>/chat` و`POST …/chat/messages` بحمولة موقع، بلا جلسة | 401 `SESSION_REQUIRED` للاثنين |
| 12 | الحزمة المنشورة: `rider-ride-*.js` فيها `ocht__loc` و`maps_url` و`ocht__tr` | موجود |
| 13 | سجلات البوابة بعد النشر بمستوى `error`/`warn` من 17:15Z | 0 سطر؛ والمهام الدورية تعمل (`job.ran`) |
| 14 | `select count(*) from order_messages` بعد النشر | 0: لم تُنشأ رسالة اختبار في الإنتاج |

| الدالة / القيد | md5(prosrc) أو `convalidated` |
|---|---|
| `post_order_message_kind(bigint, uuid, uuid, text, text, jsonb)` | `b3d2af3ba004e5b9f3407d8af37ab8b6` |
| `post_order_message(bigint, uuid, uuid, text)` | `5f6dafaa996e16dc35b0e6e5975d693b` |
| `list_order_messages(bigint, uuid, bigint, integer)` | `735a8a50141d4e3a2b12790f169297f4` |
| `order_chat_party` | `f162b5c597349944a42570623690cca0` (بلا تغيير) |
| `enqueue_order_chat_notice` | `f0fe66dbb84ea4fab621756c4802e9b6` (بلا تغيير) |
| `order_messages_kind_check` | `true` |
| `order_messages_location_payload_check` | `true` |

## الرجوع

- الشيفرة: إعادة نشر `29f3e7e6` للبوابة وMini App. البوابة السابقة تنادي `post_order_message` ذات الأربعة معاملات، وهي باقية بالتوقيع والمرد نفسهما، وتتجاهل مفاتيح `list_order_messages` الجديدة.
- القاعدة: إعادة تعريف `post_order_message` و`list_order_messages` من `20261012150000` و`20261012100000` (`rollback-registry`). العمودان `kind` و`payload` توسعة تبقى حتى طور `contract`.

## ما لا يُدَّعى

- لم تُرسل رسالة موقع ولا رسالة مترجمة بين راكب وسائق حقيقيين، ولم يُختبر زر «شارك موقعي» على تيليجرام لأندرويد أو iOS.
- الترجمة لا تعمل في الإنتاج حتى يختار المالك مزوّدًا ويضبط `TRANSLATION_PROVIDER`.
- الصور والفيديو والصوت والمستندات غير منفّذة، ويتبع فتحها نسخ بايتات Storage واستعادتها.

## ملحق — WR-06: زمن الإسناد من بدء البحث (#532)

| # | الخطوة | النتيجة |
|---|---|---|
| 1 | `md5(prosrc)` لـ`refresh_admin_metric_snapshots` قبل التطبيق | `f78c59c196889d086b704a9d18348bcc`، يطابق `20260916140100` في المستودع |
| 2 | `20261013000700_wr_06_match_time_from_search.sql` عبر `apply_migration` (النسخة الاحتياطية المتحقَّق منها نفسها، 17:14Z) | `success` |
| 3 | `md5(prosrc)` بعد التطبيق مقابل القاعدة المحلية | `a3ab3760765dec457add75b22baafbcc` في الاثنتين |
| 4 | نشر البوابة بالنشر `dep-db6hj62vcj2c73fu7ro0` | `live` على `87d70611` (17:33:07Z). Mini App بلا تغيير فلم يُعَد نشره |
| 5 | `GET /ready` وسجلات `error`/`warn` بعد النشر | `ready`، و0 سطر. ومهمة `refresh-admin-metrics` تعمل (`cities=5`) |

لا طلب مجدول مُسند في الإنتاج بعد، فالأثر لم يُقس على بيانات حقيقية. والرجوع إعادة تطبيق `20260916140100` وإعادة نشر `23e74d9c`.
