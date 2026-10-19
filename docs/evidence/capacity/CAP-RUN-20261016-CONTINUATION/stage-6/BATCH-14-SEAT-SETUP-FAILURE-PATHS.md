# الدفعة 14 — اختبارُ مساراتِ الفشلِ في `setup-env-20261016.sh`

- **التاريخ:** 2026-10-19 · **الأساس:** `main` = `4e8f4727` (بعد #590)
- **النوع:** صلابةُ عدّةِ المقعد — **ليس دليلاً على قبولِ حملٍ**؛ LOAD-01 يبقى FAIL (P2 عند 500 = 1207ms).

## ما لم يكن مغطّى بعد #590

دليلُ [الدفعة 13](BATCH-13-SEAT-SETUP-HARNESS-FIX.md) أثبتَ البناءَ من الصفر والتكرارَ وفحصَ postgis يدويّاً، ولم يُثبتْ:
فشلَ `step_migrate`، ولا فشلَ إقلاعِ PG وجاهزيّةِ Redis **من السكربتِ نفسِه**.

## التغيير

- `setup-env-20261016.sh`: القيمُ (netns، المنافذ، خادمُ Redis، الامتداداتُ، أسماءُ القواعد) قابلةٌ للتجاوزِ بمتغيّراتِ `CAP_*`، **والافتراضيُّ هو المقعدُ المعتمدُ حرفاً**.
- فشلُ `scripts/migrate.ts` صارَ صريحاً `MIGRATE_FAIL` بدلَ الاعتمادِ الضمنيِّ على `pipefail` عبرَ `| tail -1`.
- **عيبٌ كشفَه الاختبار:** رفضُ `pg_ctl start` كانَ يُسقطُ السكربتَ بـ`set -e` برسالةِ pg_ctl الخامِ قبلَ أيِّ تصنيف — صارَ `PG_START_FAIL`.
- إنشاءُ الامتداداتِ في عبارةٍ مستقلّةٍ لكلِّ امتدادٍ مع `EXTENSION_CREATE_FAIL`، والتحقّقُ البعديُّ `EXTENSION_MISSING`.
- `test-setup-env-failures.sh`: netns مستقلٌّ `ceezrfailt` وقاعدةٌ في `/tmp` ومنفذا 55499/56499؛ يرفضُ العملَ إن ساوى netns المقعد، ويهدمُ ما أنشأه وحدَه.

## النتيجة ([`raw/batch14/setup-failure-paths.jsonl`](raw/batch14/setup-failure-paths.jsonl))

| الحالة | الوسيلة | المتوقَّع | النتيجة |
|---|---|---|---|
| `pg_start` | دليلُ بياناتٍ مزيّفٌ (PG_VERSION بلا عنقود) | rc≠0 · `PG_START_FAIL` · لا `INFRA_OK` | PASS |
| `redis_ready` | `CAP_REDIS_SERVER=/bin/false` | rc≠0 · `REDIS_READY_FAIL` · لا `INFRA_OK` | PASS |
| `extension_missing` | امتدادٌ غيرُ مثبَّتٍ في القائمة (آليّةُ فشلِ postgis نفسُها) | rc≠0 · `EXTENSION_CREATE_FAIL` · لا `DB_OK` | PASS |
| `migrate_no_db` | قاعدةٌ غيرُ موجودة | rc≠0 · `MIGRATE_FAIL` · لا `MIGRATE_OK` | PASS |
| `migrate_sql_error` | قاعدةٌ بلا postgis ⇒ أوّلُ هجرةٍ تسقطُ على `geography` | rc≠0 · `MIGRATE_FAIL` · لا `MIGRATE_OK` | PASS |
| `db_happy_control` | العنقودُ نفسُه بالقيمِ السليمة | rc=0 · `DB_OK` | PASS |

ثمّ على المقعدِ المعتمدِ بلا إعادةِ بناء: `infra` ⇒ `INFRA_OK` (rc=0). و`migrate` منفرداً على قاعدةٍ مُرحَّلةٍ سلفاً ⇒ `MIGRATE_FAIL` (rc=1)
لأنَّ السلسلةَ لقاعدةٍ فارغةٍ بالتصميم؛ سقطَت المعاملةُ كاملةً فلم يتغيّر شيء. فالترتيبُ الصحيحُ لإعادةِ التهيئة `db` ثمّ `migrate` (أو `all`).

## ما لم يُقَس

- فرعُ `PG_READY_FAIL` (إقلاعٌ قُبِلَ ثمّ لم يستقم خلالَ 30ث) شرطٌ بعديٌّ لم يُعَد إنتاجُه.
- السكربتُ يحتاجُ `sudo -n` وnetns، فلا يُشغَّلُ في CI؛ هو اختبارُ مقعدٍ يُشغَّلُ يدويّاً قبلَ أيِّ تأهيل.
