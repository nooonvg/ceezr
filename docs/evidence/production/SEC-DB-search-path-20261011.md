# SEC-DB — `search_path` للدوالّ و`spatial_ref_sys` — 2026-10-11

**القاعدة:** مشروعُ Supabase الإنتاجيّ `veer` (`jafuchojgxzeuvibkkfx`، PostgreSQL 17.6). **كلُّ ما في هذا الملفِّ قراءةٌ بلا كتابة** إلى أن تُطبَّقَ الهجرةُ `20261011120000_pin_function_search_path.sql` (انظر §4).

## 1. ما يقولُه المُدقِّق

`get_advisors(security)`: `function_search_path_mutable` × 24 (WARN) · `rls_disabled_in_public` × 1 (ERROR، `spatial_ref_sys`) · `extension_in_public` (`postgis`، `pg_trgm`) · تحذيرُ `security definer` على دالّةٍ من PostGIS (`st_estimatedextent`).

## 2. الدوالُّ الـ24 دالّةً دالّة

المقاسُ من `pg_proc` لكلٍّ منها: **`prosecdef = false`** (security invoker) · المالكُ `postgres` · **`anon` و`authenticated` لا ينفّذانِها** (`has_function_privilege` = false) · `proconfig` فارغ. ومن `pg_depend`: لا تدخلُ أيٌّ منها في فهرسٍ ولا قيدٍ ولا عمودٍ مُولَّدٍ ولا عرض؛ وحدَها اثنتانِ مُشغِّلتان. ومسارُ القاعدةِ `"$user", public, extensions`، ولا دورَ غيرُ المالكِ يملكُ `CREATE` على `public` (`anon`/`authenticated`/`PUBLIC` = false).

| # | الدالّة | اللغة | التقلّب | ما تُحَلُّ إليه أسماؤها |
|---|---|---|---|---|
| 1 | `authority_data_request_deadline(authority_request_urgency, timestamptz)` | sql | i | النوعُ `authority_request_urgency` (public) |
| 2 | `authority_notification_deadline(timestamptz)` | sql | i | pg_catalog فقط |
| 3 | `authority_notification_is_overdue(uuid)` | sql | s | `breach_incidents` · `authority_notification_deadline` |
| 4 | `broadcast_filter_values(jsonb, text)` | sql | i | pg_catalog فقط (`jsonb_*`) |
| 5 | `driver_activity_window(text, text, timestamptz)` | plpgsql | i | pg_catalog فقط |
| 6 | `driver_attendance_seconds(uuid, timestamptz×3)` | sql | s | `attendance_log` |
| 7 | `pdpl_cross_border_transfer_allowed(uuid)` | sql | i | `pdpl_cross_border_transfers` |
| 8 | `pdpl_cross_border_transfer_is_expired(uuid)` | sql | i | `pdpl_cross_border_transfers` |
| 9 | `pdpl_dpia_is_approved(uuid)` | sql | i | `pdpl_dpia_assessments` |
| 10 | `pdpl_dpia_required(uuid)` | sql | i | `pdpl_processing_activities` |
| 11 | `pdpl_high_risk_requires_dpia(uuid)` | sql | i | دالّتا `pdpl_dpia_*` |
| 12 | `pdpl_processing_activity_is_allowed(uuid)` | sql | i | `pdpl_processing_activities` |
| 13 | `pdpl_right_request_deadline(timestamptz)` | sql | i | pg_catalog فقط |
| 14 | `pdpl_right_request_is_overdue(uuid)` | sql | v | `pdpl_data_subject_requests` |
| 15 | `set_request_id()` | plpgsql | v | `current_request_id()` — مُشغِّلٌ على `audit_log` و`notification_outbox` و`ledger_entries` |
| 16 | `subject_notification_required(uuid)` | sql | s | `breach_incidents` |
| 17 | `subscription_invoices_are_immutable()` | plpgsql | v | pg_catalog فقط — مُشغِّلا منعِ التعديلِ والحذفِ على `subscription_invoices` |
| 18 | `subscription_payment_is_settled(text)` | sql | i | pg_catalog فقط |
| 19 | `subscription_tax_invoice_payload(subscription_invoices)` | sql | i | نوعُ الصفِّ (public) |
| 20 | `zatca_generate_invoice_uuid()` | sql | i | `gen_random_uuid` (pg_catalog منذ PG13) |
| 21 | `zatca_generate_ubl_xml(text, uuid, timestamptz, text×3, integer×4, text, integer)` | sql | i | pg_catalog فقط (`xml*`) |
| 22 | `zatca_invoice_hash(text)` | sql | i | **`digest` من `pgcrypto` في `extensions`** ⇐ `public, extensions, pg_temp` |
| 23 | `zatca_simplified_invoice_qr(text, text, timestamptz, integer, integer)` | sql | i | `zatca_tlv_field` |
| 24 | `zatca_tlv_field(integer, text)` | plpgsql | i | pg_catalog فقط |

## 3. الحكم

- **لا ثغرةَ تصعيدِ صلاحيّةٍ قائمة:** لا `security definer`، ولا منفِّذَ من الدورَين العامَّين، ولا أحدَ يزرعُ كائنًا يحجبُ اسمًا في `public`.
- **الخطرُ الحقيقيُّ صحّةٌ لا أمان:** الحلُّ يتبعُ مسارَ الجلسة. وأوضحُ مثال: `zatca_invoice_hash` تعملُ لأنَّ `extensions` في المسار؛ جلسةٌ مسارُها فارغٌ أو `public` وحدَه (أداةُ استعادةٍ أو دورٌ آخر) تسقطُ بـ`function digest(...) does not exist`.
- **الإصلاحُ المختار:** تثبيتٌ يحفظُ الحلَّ الحاليَّ حرفًا: `public, pg_temp` للـ23، و`public, extensions, pg_temp` لـ`zatca_invoice_hash`. لا تغييرَ في جسمٍ ولا صلاحيّةٍ ولا مالك. والكلفةُ الوحيدةُ أنَّ دالّةَ SQL ذاتَ `SET` لا تُضمَّنُ (inline) — ولا واحدةَ منها في مسارٍ ساخنٍ ولا في فهرس (§2).
- **التحقّقُ قبلَ التطبيق:** التواقيعُ الـ24 تُحَلُّ في الإنتاجِ إلى 24 دالّةً متمايزة (`'…'::regprocedure`، قراءة). والمُطبِّقُ الآمنُ في CI يُطبِّقُ السلسلةَ مرّتَين على PostgreSQL حقيقيّ، والطبقةُ ٤ في `tests/integration/database-privilege-surface.test.ts` تشترطُ أنَّ كلَّ دالّةٍ من دوالِّنا مُثبَّتةُ المسار، وتنادي ثلاثًا منها بمسارِ جلسةٍ فارغ.
- **الرجوع:** `alter function public.<sig> reset search_path;` لكلِّ دالّة — فوريٌّ، بلا فقدِ بيانات.

## 4. `spatial_ref_sys` — لا تغيير، عن دليل

| المقاس | القيمة |
|---|---|
| المالك | `supabase_admin` (لا `postgres`) — تفعيلُ RLS يتطلّبُ المالكَ، فهو غيرُ ممكنٍ لدورِ المشروعِ أصلًا |
| العضويّة | عضوٌ في الامتداد `postgis` 3.3.7 (`pg_depend` deptype `e`) |
| المحتوى | 8500 صفٍّ من تعريفاتِ EPSG العامّة — لا بيانةَ مستخدم |
| الصلاحيّات | `=r/supabase_admin` (قراءةٌ لـ`PUBLIC`)، ولا `INSERT` للدورَين العامَّين |
| الوصولُ عبرَ PostgREST | `anon`/`authenticated` بلا `USAGE` على `public`؛ وطلبٌ فعليٌّ بالمفتاحِ القابلِ للنشرِ إلى `/rest/v1/spatial_ref_sys` ⇐ **401 `42501 permission denied for schema public`** (ومثلُه `/rest/v1/cities`) — 2026-10-11 |

البدائلُ ومخاطرُها: تفعيلُ RLS غيرُ ممكنٍ بدورِ المشروع، ولو أمكنَ لكسرَ قراءةَ PostGIS لمعرّفاتِ الإسقاط على أدوارٍ بلا سياسة؛ ونقلُ `postgis` إلى مخطّطٍ آخرَ يقتضي `drop extension … cascade` فيُسقِطُ أعمدةَ `geography` وفهارسَها — **مُدمِّر**. فالحكم: **خطرٌ مقبولٌ موثَّق**، والحمايةُ الفعليّةُ هي الطبقةُ ٣ (لا `USAGE`) المُختبَرةُ دائمًا. وينطبقُ الشيءُ نفسُه على `extension_in_public` وتحذيرِ `st_estimatedextent` (دالّةُ امتداد، غيرُ مكشوفة).

## 5. ما لم يُفعَل

- لم تُطبَّق الهجرةُ على الإنتاجِ قبلَ مرورِ CI والدمج.
- لم يُمَسَّ `spatial_ref_sys` ولا امتدادٌ ولا ملكيّة.
