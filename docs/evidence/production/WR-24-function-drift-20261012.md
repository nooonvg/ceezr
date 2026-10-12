# WR-24 · WR-21 · WR-15 — انحرافُ ثلاثِ دوالَّ في الإنتاج، وحالةُ نشرِ #499 — 2026-10-12

**القاعدة:** مشروعُ Supabase الإنتاجيّ `veer` (`jafuchojgxzeuvibkkfx`، PostgreSQL 17.6). كلُّ ما في §1–§3 **قراءةٌ بلا كتابة** (`select` على `pg_proc` و`supabase_migrations.schema_migrations` و`notification_outbox` و`db_backups`)، بين 01:20 و02:10Z يوم 2026-10-12.

## 1. حالةُ النشرِ الحقيقيّة قبلَ هذا التغيير (من Render، لا من الوثائق)

| الخدمة | الـcommit الحيّ | deploy | الوقت |
|---|---|---|---|
| `waslah-gateway` | `5609cf58` (#499) | `dep-db62joajnfac73c6ih10` | live 00:30:01Z |
| `waslah-miniapp` | `5609cf58` (#499) | `dep-db62jo7lot8c738l464g` | live 00:29:31Z |
| `waslah-miniapp-staging` | — | — | suspended |

- هجرتا `WR-15` (`20261012120000` و`20261012120100`) مسجَّلتانِ في `supabase_migrations` بإصدارَي `20261012002846` و`20261012002905` — أي **طُبِّقتا قبلَ نشرِ البوّابة** (00:28Z ثمَّ 00:29Z). فعبارةُ STATUS «لم تُطبّقا على الإنتاج بعد» كانت تصفُ لحظةَ فتحِ PR #499 لا ما بعدَه.
- `md5(prosrc)` في الإنتاج = المحلّيّة لـ`enqueue_rider_trip_notice` (`1e551d4a…`) و`claim_notification_delivery` (`e31b8ae5…`)، ولدوالِّ المحادثةِ الثلاث وغلافِ `request_ride_with_offer` (`52623445…`).
- `/ready` (02:00Z): `{"status":"ready","missingEnv":[],"failedChecks":[],"degradedChecks":[]}`.
- `notification_outbox`: لا صفَّ `rider_trip_notice` بعدُ — **لا طلبَ جديدَ في الإنتاج منذ النشر** (`orders`: 5 `completed` و1 `cancelled`، كلُّها قبلَ 2026-10-11). فالمسارُ منشورٌ ومطابقٌ لكنَّه **غيرُ مُمارَسٍ إنتاجيًّا**.
- سجلُّ البوّابةِ منذ 00:29Z بمستوى `warn|error`: سطرٌ واحد `move_event_outbox.shipper_not_configured` عندَ الإقلاع (انظر §4).
- `cron.job`: `ops-gateway-watchdog` (كلَّ دقيقة) و`ops-watchdog-events-prune` (يوميًّا 03:17)، كلاهما `active`. ومهامُّ العاملِ (`redispatch-searching`، `expire-offers`، `deliver-*`، `flush-driver-locations`…) تُسجِّلُ `job.ran` لكلِّ مدينةٍ من الخمس.

## 2. الانحراف: مقارنةُ كلِّ دوالِّ `public`

الطريقة: `md5(prosrc)` لكلِّ دالّةٍ في `public` ليست من امتداد (279 في الطرفين)، في الإنتاج وفي قاعدةٍ محلّيّةٍ (PostgreSQL 17 + PostGIS 3.6) طُبِّقَت عليها السلسلةُ كاملةً بـ`scripts/migrate.ts` (239 هجرة). ستُّ دوالَّ تختلف:

| الدالّة | الفرق | الحكم |
|---|---|---|
| `search_destinations` | تعليقاتٌ فقط | لا أثر |
| `request_ride_with_terms` (12 وسيطًا) | تنسيقُ أسطرٍ فقط، والمنطقُ واحد | لا أثر |
| `identity_hash` | `extensions.hmac` في الإنتاج و`public.hmac` محلّيًّا | فرقُ بيئة (موضعُ `pgcrypto`)، لا أثر |
| **`claim_ride`** | الإنتاجُ = صورةُ `20260806120100_phase_2_1_atomic_rpcs.sql` حرفًا | **انحرافٌ حقيقيّ** |
| **`start_trial`** | الإنتاجُ = صورةُ الأساسِ نفسِه | **انحرافٌ حقيقيّ** |
| **`activate_subscription`** | الإنتاجُ = صورةُ الأساسِ نفسِه | **انحرافٌ حقيقيّ** |

إثباتُ المصدر: أُنشئَت قاعدةٌ ثالثةٌ لم يُطبَّق عليها إلّا `phase_2_1_core_schema` و`phase_2_1_atomic_rpcs`؛ الدوالُّ السبعُ في ملفِّ الأساسِ تطابقُ الإنتاجَ **كلُّها**، والأربعُ التي لم تتغيّر بعدَه تطابقُ المحلّيّةَ أيضًا. فالنمطُ نمطُ **إعادةِ تشغيلِ ملفِّ الأساسِ** على الإنتاج بعدَ الهجراتِ اللاحقة، مع أنَّ `supabase_migrations` يسجّلُ تلك اللاحقة (`20260814160000`، `20260903120000`، `20260812150000`، `20260814010000`، `20260920200000`). **ووقتُ ذلك وفاعلُه غيرُ مسجَّلَين** في المستودعِ ولا في السجلّ؛ لا يُدَّعى سببٌ أكثرَ من النمط.

`prosecdef = true` و`search_path=public` والصلاحيّاتُ `service_role` وحدَها — كما في الصورةِ الصحيحة.

### أثرُ كلِّ انحرافٍ على الاستخدام

- **`claim_ride`** (يتبعُ `WR-24` و`WR-15`): الصورةُ الإنتاجيّةُ لا تُرجِعُ `rider` ولا `driver_name`/`driver_plate`/`driver_vehicle` ولا `duplicate`. فـ:
  - قبولُ السائقِ **من رسالةِ البوت** لا يُخطِرُ الراكبَ ألبتّة (`notifyRiderOfAcceptance` يخرجُ عندَ `rider === null`).
  - النقرةُ المكرَّرةُ للفائزِ نفسِه تُجابُ «سبقَك غيرُك» (`ORDER_NOT_CLAIMABLE`) عن رحلةٍ صارت رحلتَه (`BUG-008`).
  - قبولُ Mini App لا يتأثّرُ بالإخطار: يودعُ `rider_trip_notice` ويقرأُ الحقائقَ من القاعدة.
- **`start_trial`** (يتبعُ `WR-21`): لا يرفضُ `DRIVER_NOT_VERIFIED` ولا `CITY_NOT_ACTIVE` — سائقٌ غيرُ موثَّقٍ يبدأُ تجربةً (`PD-040`).
- **`activate_subscription`**: لا يُزامِنُ `driver_capabilities` مع الخطّة، ولا يودعُ إشعارَ التفعيل.

## 3. ما يسبقُ التطبيق

- **النسخةُ الاحتياطيّة:** أحدثُ صفٍّ في `db_backups` = `wasla-backup-20261012T004258Z.tar.age` (`success`، `restore_verification_status = verified` على `ci-ephemeral-postgis17`، [تشغيلُ `ceezr-backups` 38188886460](https://github.com/uxxxug/ceezr-backups/actions/runs/38188886460)). بايتاتُ Storage غيرُ منسوخة (`not_configured`) ولا صلةَ لها بهذا التغيير.
- **طبيعةُ الهجرة:** `create or replace` لثلاثِ دوالَّ بالتوقيعِ والمردِّ نفسِهما، أجسامُها منسوخةٌ حرفًا عن آخرِ هجرةٍ عرّفَت كلًّا منها. لا جدولَ ولا صفَّ يُمَسّ، والصلاحيّاتُ تُحفَظ. على القاعدةِ المحلّيّةِ أعطَت `md5` نفسَه قبلَ التطبيقِ وبعدَه (الإعادةُ بلا أثر).
- **الرجوع:** إعادةُ الأجسامِ الثلاثةِ من `20260806120100_phase_2_1_atomic_rpcs.sql` (الأسطر 79–233) — فوريٌّ وبلا فقدِ بيانات. ولا سببَ معروفًا يدعو إليه.
- **ترتيبُ النشر:** الهجرةُ أوّلًا ثمَّ البوّابة. الصورةُ الصحيحةُ من `claim_ride` توسيعٌ لمفاتيحِ المردِّ تقرؤها البوّابةُ الحاليّةُ أصلًا، فلا نافذةَ كسرٍ في أيِّ ترتيب.

## 4. `move_event_outbox.shipper_not_configured`

- المصدر: `apps/workers/src/container.ts` يسجّلُه `error` عندَ كلِّ إقلاعٍ حينَ يغيبُ `CORE_EVENTS_BASE_URL` أو `CORE_EVENTS_BEARER_TOKEN`.
- السببُ ليسَ إعدادًا ناقصًا: **تكاملُ CORE مؤجَّلٌ بتعليمةِ المالكِ `O-7`** (ADR 0094 · ADR 0095، `deferred/core-integration/README.md`)، وجدولُ `move_event_outbox` في `deferred/` لا يُطبَّقُ على قاعدةِ المنتج. فلا قيمةَ صحيحةً تُضبَطُ اليوم، واختراعُها ممنوع.
- العلاج في هذا التغيير: الغيابُ التامُّ يُسجَّلُ `info` باسمِ `move_event_outbox.deferred` ومعه `decision: "O-7 · ADR 0094"`، ويبقى `error` (`move_event_outbox.shipper_partially_configured`) إن ضُبِطَ أحدُ المتغيّرَين دونَ الآخر.

## 5. ما لم يُقَس

- ظهورُ أيِّ إشعارٍ على هاتفِ راكب: لا يقيسُه النظام، ولم يُنشأ طلبٌ إنتاجيٌّ للتجربة (يصلُ سائقين حقيقيّين).
- اختبارُ تكاملٍ للحاويةِ كاملةً بسطحِ `miniapp`: تجهيزُ اختباراتِ التكاملِ بسطحِ `legacy`، فالتنسيقُ الجديدُ مقيسٌ باختبارِ وحدةٍ للحوار (`tests/unit/wr-15-bot-trip-notice-outbox.test.ts`)، ومنعُ التكرارِ على القاعدةِ مقيسٌ في `tests/integration/wr-15-rider-trip-notice-outbox.test.ts`.
