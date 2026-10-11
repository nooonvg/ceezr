# النسخُ الاحتياطيّ وملفّاتُ Storage — 2026-10-11

## 1. ما يعملُ فعلًا (مقروءٌ لا مفترَض)

| | الدليل |
|---|---|
| النسخُ الليليُّ من `uxxxug/ceezr-backups` (`nightly-backup.yml`، 00:17Z) | `db_backups`: 11 تشغيلًا ناجحًا 2026-10-04 → 10-11، كلُّها `verified`، و`remote_file_id` = `gh-artifact:…` |
| المحتوى | `pg_dump` لـ`public` و`supabase_migrations`، و`aux.dump` بياناتُ `auth`/`storage` الوصفيّة (`aux_dump.status = ok` في آخرِ تشغيل) |
| التشفير | `age` إلى مفتاحٍ عامّ؛ الخاصُّ ليسَ في GitHub (`encrypt.sh` يرفضُ مفتاحًا خاصًّا) |
| الاحتفاظ | 30 يومًا (`RETENTION_DAYS`، يحرسُه CI المستودع) |
| التنبيه | `backup-watchdog.yml` كلَّ 6 ساعات: يفشلُ (بريدُ GitHub) إن لم تُسجَّل نسخةٌ `verified` خلالَ 26 ساعة |
| تمرينُ الاستعادة | PRD-104 Verified (2026-10-10، تمرينُ المالكِ المحلّيّ) |

## 2. Google Drive — **لا يعمل في الإنتاج**

الكودُ موجود (`apps/workers/src/container.ts` `readBackupConfig`، ومتغيّراتُ `GOOGLE_*` في `render.yaml` بـ`sync: false`)، لكن:
- `job_heartbeats`: 71 مهمّةً تنبضُ (آخرُها 2026-10-11 18:02Z)، **ولا واحدةَ** باسمِ `backup-database` ولا `verify-backup-restore` — والمهمّتانِ لا تُسجَّلانِ إلّا حينَ يكونُ الإعدادُ موجودًا.
- سجلُّ `waslah-gateway` منذُ 2026-09-20: صفرُ أسطرٍ لـ`backup-database`/`verify-backup-restore`.
- `location_archive_manifest` = 0 صفّ — وأرشيفُ المواقعِ يعتمدُ على مخزنِ النسخِ نفسِه، **فهو مُطفأٌ أيضًا** (أثرٌ جانبيٌّ يُذكَر).

**لم يُحذَف شيءٌ ولم تُغيَّر وجهة.** إزالةُ مسارِ Drive من الكودِ أو إبقاؤه قرارُ مالك (§5).

## 3. مشروعُ «maaavg» (`qqxeuzkseecirxziqygh`)

`INACTIVE`، سيول. لا إشارةَ إليه في كودِ `ceezr` ولا `render.yaml` ولا مستودعِ النسخ — الإشاراتُ الوحيدةُ في وثيقتَي الحوكمة (`OWNER-QUESTIONS-20261009.md` و`DATA-HOSTING-REGIONS-20261009.md`). فلا دليلَ على أنّه جزءٌ من البنية. **لم يُمَسّ.**

## 4. ملفّاتُ Storage — الفجوةُ والحلّ

**الفجوة:** `pg_dump` يحفظُ صفوفَ `storage.objects` لا البايتات، ونسخُ Supabase نفسُها لا تشملُ كائناتِ Storage ([Supabase — Database Backups](https://supabase.com/docs/guides/platform/backups)). اليومَ `driver-documents` = **0 كائن** (و`probe-signing` = 1 كائن، 13 بايت)، فلا فقدَ واقع — لكنَّ أوّلَ وثيقةٍ يرفعُها سائقٌ ستكونُ بلا نسخة.

**الحلُّ المدموج** — `uxxxug/ceezr-backups` PR #4 (دُمِجَ، `b140f5dd`):

| الجانب | التنفيذ |
|---|---|
| الملفّات | `scripts/storage-dump.sh` ينسخُ حاوياتِ `STORAGE_BACKUP_BUCKETS` (افتراضيًّا `driver-documents`) عبرَ S3 الخاصِّ بـStorage، ويشترطُ أن يُنسَخَ **كلُّ** كائنٍ في `storage.objects` بحجمِه المسجَّل (الكائنُ المحذوفُ أثناءَ التشغيلِ يُعادُ فحصُه حيًّا) |
| البيانُ الوصفيّ | `aux.dump` القائم + `storage.json` (sha256 وحجمُ كلِّ ملفّ) داخلَ الأرشيف |
| التشفير | الأرشيفُ نفسُه بـ`age`؛ البايتاتُ النصّيّةُ تُمحى بـ`shred` بعدَه |
| الصلاحيّة | زوجُ مفاتيحِ **S3 لـStorage** (لا وصولَ للقاعدة) بدلَ `service_role`. حدٌّ معلَن: مفاتيحُ S3 في Supabase «تمنحُ كلَّ عمليّاتِ S3 على كلِّ الحاويات وتتجاوزُ RLS» ([Supabase — S3 Authentication](https://supabase.com/docs/guides/storage/s3/authentication))، ولا مفتاحَ قراءةٍ فقط |
| سرّيّةُ المفاتيح | أسرارُ GitHub في المستودعِ الخاصّ وحدَه، ومُقنَّعةٌ في السجلّ (`::add-mask::`)؛ وفحصُ التسرّبِ في selftest |
| الاحتفاظ | 30 يومًا كبقيّةِ النسخة |
| اختبارُ الاستعادة | `scripts/storage-verify.sh` (sha256) قبلَ التشفيرِ وعلى الأرشيفِ المفكوك؛ وخطواتُ الرفعِ إلى مشروعٍ هدفٍ في `docs/RESTORE.md` §6.1 |
| التنبيه | فشلُ النسخِ أو التحقّق ⇐ يفشلُ التشغيلُ بعدَ تسجيلِ نسخةِ القاعدة. **ووجودُ كائناتٍ بلا مفاتيحَ مُعدّة ⇐ يفشلُ التشغيلُ أيضًا** — فلا فجوةَ صامتة |

**الاختبارات:** selftest على CI المستودع (`38162480202`): **32 نجاح / 0 فشل**، منها 11 جديدةً (بايتاتٌ مطابقةٌ بعدَ فكِّ التشفير، رفضُ ملفٍّ معدَّل، رفضُ كائنٍ لم يُنسَخ، رفضُ حجمٍ مخالف، الإبلاغُ عن غيرِ المُعدّ، رفضُ إعدادٍ جزئيّ، رفضُ منفذِ الاختبارِ داخلَ Actions، النصُّ المشفَّرُ لا يحوي البايتات).

**تشغيلٌ حقيقيٌّ بعدَ الدمج — من سجلِّه لا من الشيفرة:** `nightly-backup` `38163083177` على `b140f5dd` (الوظيفة `114539902643`، سجلٌّ من 564 سطرًا قُرِئَ عبرَ `GET /actions/jobs/{id}/logs`):

| الخطوة | النتيجة | ما قالَه السجلّ |
|---|---|---|
| 6. Dump | success (18:16:42→18:18:54) | — |
| 7. Copy Storage bytes | success (18:18:54→18:18:56) | `STORAGE_S3_ENDPOINT` و`AWS_ACCESS_KEY_ID` فارغان؛ «**Storage bytes not configured; database expects 0 objects**»؛ «storage: not configured (0 object(s) expected) — nothing to verify»، ثمَّ — **خطأً** — «Storage bytes verified» |
| 8. Restore + fingerprints | success | «restore verified in 438 ms» |
| 9. Encrypt | success | `wasla-backup-20261011T181857Z.tar.age` = 1669720 بايت، sha256 `0523a5fc21ece99ea8c1d0030825355b984c2c47ac6fc4d9b9c371fab1b6560a` |
| 10–11. Upload + re-download | success | artifact `11711196312`، «sha256 matches» |
| 15. Fail if Storage bytes are not covered | success | لأنَّ الكائناتِ المتوقَّعةَ 0 |

**الخلاصة الصحيحة:** **لم يُجلَب أيُّ ملفٍّ من Storage** — لا مفاتيح، و`driver-documents` فارغة. الأرشيفُ المشفَّرُ يحوي `storage.json` بحالةِ `not_configured` ولا مجلّدَ `storage/`. فلا عددَ ملفّاتٍ ولا أحجامَ ولا بصماتِ وثائقَ لتُذكَر: **صفر**. وعبارةُ «Storage bytes verified» عيبٌ أُصلِح (§4.1).

**فكُّ التشفير:** المفتاحُ الخاصُّ عندَ المالكِ وحدَه (`encrypt.sh` يرفضُ مفتاحًا خاصًّا في GitHub)، فلم أفكَّ الأرشيفَ الحقيقيّ — وهذا مقصودُ التصميم. فكُّه مُثبَتٌ بتمرينِ المالكِ 2026-10-10 (PRD-104) وبالاختبارِ الذاتيّ بمفتاحٍ مؤقّت.

### 4.1 ما أُصلِحَ بعدَ قراءةِ السجلّ — `ceezr-backups` #5

| العيب | الإصلاح |
|---|---|
| «Storage bytes verified» حينَ لا شيءَ نُسِخ | `storage-verify.sh` يقولُ «Storage bytes NOT in this backup (not configured): nothing verified» |
| `storage_file_bytes_included` ثابتٌ `false` في `db_backups`، ولا ملخّصَ لـStorage | `storage-dump.sh` يكتبُ في `manifest.json` ملخّصًا (الحالة، المصدر، المتوقَّع، المنسوخ، البايتات — **بلا أسماءِ كائنات**)، و`storage_file_bytes_included = true` فقط حينَ نُسِخَ الكلُّ عبرَ S3؛ ويصلُ إلى `db_backups.restore_verification_detail` |
| لا أداةَ استعادةٍ مُتحقَّقٍ منها | `scripts/storage-restore.sh`: إلى وجهةٍ معزولة، يرفضُ حاويةً غيرَ فارغةٍ أو مفقودة، ويشترطُ كتابةَ مضيفِ الوجهة، ويرفضُ أرشيفًا معدَّلًا أو بلا بايتات، ثمَّ **ينزّلُ كلَّ كائنٍ من الوجهةِ ويطابقُ sha256** |
| مسارُ S3 غيرُ مُختبَرٍ أصلًا | CI بخادمَي S3 محلّيّين (moto) وبياناتٍ مزيّفة: نسخٌ عبرَ S3 ⇐ تشفير ⇐ فكّ ⇐ استعادةٌ إلى وجهةٍ معزولة ⇐ مطابقةُ البايتات |
| AWS CLI ≥ 2.23 يرسلُ بصماتِ CRC افتراضًا، وSupabase S3 لا يدعمُها | `AWS_REQUEST_CHECKSUM_CALCULATION` و`AWS_RESPONSE_CHECKSUM_VALIDATION` = `when_required` |

### 4.2 أقلُّ صلاحيةٍ ممكنة — لم يُفعَّل شيء

| الخيار | الصلاحية الفعليّة | ما يلزم |
|---|---|---|
| مفاتيحُ S3 (Storage ← S3 Access Keys) | «كلُّ عمليّاتِ S3 على كلِّ الحاويات، وتتجاوزُ RLS» ([Supabase](https://supabase.com/docs/guides/storage/s3/authentication)) — قراءةٌ **وكتابةٌ وحذفٌ** لكلِّ وثيقة. وتسرّبُها من أسرارِ GitHub = كشفُ الوثائقِ وإمكانُ إتلافِها | سرّانِ ومتغيّران — لا شيفرة |
| **Session token** (الأضيق) | «كلُّ العمليّاتِ مُقيَّدةٌ بالمستخدمِ المصادَق، وتُحترَمُ سياساتُ RLS على مخطّطِ Storage» ([Supabase](https://supabase.com/docs/guides/storage/s3/authentication)): مستخدمُ خدمةٍ مخصّص + سياسةُ `select` وحدها على `storage.objects` لحاويةِ `driver-documents` ⇐ **قراءةٌ فقط لحاويةٍ واحدة** | قرارُك: إنشاءُ مستخدمِ خدمةٍ في Auth (غيرِ مستعمَلٍ اليوم) وهجرةُ سياسة، ثمَّ دعمُ الرمزِ القصيرِ في `storage-dump.sh` (لم يُكتَب: لا يُختبَرُ بلا المشروع) |

وحمايةُ مفتاحِ التشفير: العامُّ وحدَه في GitHub (`vars.BACKUP_AGE_RECIPIENT`)، والخاصُّ خارجَه؛ فقدُه = كلُّ النسخِ غيرُ قابلةٍ للاستعادة (`RESTORE.md` §7). والاحتفاظ 30 يومًا للقاعدةِ والملفّاتِ معًا، ويحرسُه CI المستودع.

### 4.3 حمايةُ التشغيل — ADR 0261

مُوقِّعُ الرفعِ **مُهيَّأٌ في الإنتاج** (لا `driver_documents.signer_not_configured` في سجلِّ البوّابةِ منذُ 2026-09-15)، فكانَ الرفعُ ممكنًا بلا نسخة. فصارَ إذنُ الرفعِ يشترطُ `DRIVER_DOCUMENT_UPLOADS=enabled` حرفًا، وغيابُه إيقافٌ يردُّ `UPLOAD_NOT_AVAILABLE`. يُفتَحُ بعدَ تمرينِ §4.1 ناجحٍ على مشروعٍ معزول.

## 5. ما يحتاجُ المالك

1. **قبلَ فتحِ الرفع (ADR 0261):** اختيارُ الصلاحيةِ في §4.2، ثمَّ إنشاءُ زوجِ مفاتيحِ S3 في Supabase (Storage ← S3 Access Keys)، وإضافتُه سرّين `STORAGE_S3_ACCESS_KEY_ID` و`STORAGE_S3_SECRET_ACCESS_KEY` في `ceezr-backups`، ومتغيّرَي `STORAGE_S3_ENDPOINT` = `https://jafuchojgxzeuvibkkfx.storage.supabase.co/storage/v1/s3` و`STORAGE_S3_REGION` = `ap-southeast-2`. بلا ذلك يفشلُ التشغيلُ الليليُّ عمدًا من أوّلِ كائن.
2. مسارُ Google Drive غيرُ المستعمَل: إبقاؤه بديلًا خاملًا أم إزالتُه — وأرشيفُ المواقعِ المُطفأُ معه.
3. «maaavg»: لا أثرَ له في البنية؛ حذفُه أو إبقاؤه قرارُك.
