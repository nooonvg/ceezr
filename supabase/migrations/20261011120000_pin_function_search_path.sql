-- الغرض: تثبيتُ `search_path` على الدوالّ الـ24 التي يُبلِغُ عنها مُدقِّقُ Supabase
--   (`function_search_path_mutable`) — **تثبيتًا يحفظُ ما تُحَلُّ إليه أسماؤها اليوم**.
-- الحالة: تُطبَّقُ بالمُطبِّقِ الآمنِ (F7-07) في معاملةٍ واحدة. مسترجَعةٌ بطبيعتِها
--   (`alter function … set` يُعادُ بلا أثر).
-- ينتمي إلى: supabase/migrations
-- الدليل والتحليلُ دالّةً دالّة: `docs/evidence/production/SEC-DB-search-path-20261011.md`
--
-- لماذا ليست ثغرةً قائمةً بل تقسية: الـ24 كلُّها `security invoker` يملكُها `postgres`،
--   ولا ينفّذُها `anon` ولا `authenticated` (الطبقة ٢)، ولا أحدَ غيرُ المالكِ يملكُ
--   `create` على `public`. فالخطرُ تغيّرُ الحلِّ بتغيّرِ مسارِ الجلسة (أداةُ استعادةٍ
--   تضبطُه فارغًا، أو دورٌ مسارُه مختلف) لا تصعيدُ صلاحية.
-- لماذا هذه القيمة: مسارُ القاعدةِ اليومَ `"$user", public, extensions`، ولا دالّةَ منها
--   تُشيرُ إلى غيرِ `pg_catalog` و`public` إلّا `zatca_invoice_hash` (`digest` من
--   `pgcrypto` في `extensions`). و`pg_temp` آخِرًا صراحةً كي لا يسبقَ `public` في الجداول.
--   والمخطّطُ غيرُ الموجودِ في المسارِ يُتجاهَلُ (قاعدةُ CI بلا `extensions`).
-- ما لا تفعله: لا تُغيِّرُ جسمَ دالّةٍ ولا صلاحيّتَها ولا مالكَها ولا تُمسُّ دوالَّ الامتدادات.
-- الرجوع: `alter function public.<sig> reset search_path;` لكلِّ دالّة.
-- migration-phase: expand

alter function public.authority_data_request_deadline(authority_request_urgency, timestamp with time zone) set search_path = public, pg_temp;
alter function public.authority_notification_deadline(timestamp with time zone) set search_path = public, pg_temp;
alter function public.authority_notification_is_overdue(uuid) set search_path = public, pg_temp;
alter function public.broadcast_filter_values(jsonb, text) set search_path = public, pg_temp;
alter function public.driver_activity_window(text, text, timestamp with time zone) set search_path = public, pg_temp;
alter function public.driver_attendance_seconds(uuid, timestamp with time zone, timestamp with time zone, timestamp with time zone) set search_path = public, pg_temp;
alter function public.pdpl_cross_border_transfer_allowed(uuid) set search_path = public, pg_temp;
alter function public.pdpl_cross_border_transfer_is_expired(uuid) set search_path = public, pg_temp;
alter function public.pdpl_dpia_is_approved(uuid) set search_path = public, pg_temp;
alter function public.pdpl_dpia_required(uuid) set search_path = public, pg_temp;
alter function public.pdpl_high_risk_requires_dpia(uuid) set search_path = public, pg_temp;
alter function public.pdpl_processing_activity_is_allowed(uuid) set search_path = public, pg_temp;
alter function public.pdpl_right_request_deadline(timestamp with time zone) set search_path = public, pg_temp;
alter function public.pdpl_right_request_is_overdue(uuid) set search_path = public, pg_temp;
alter function public.set_request_id() set search_path = public, pg_temp;
alter function public.subject_notification_required(uuid) set search_path = public, pg_temp;
alter function public.subscription_invoices_are_immutable() set search_path = public, pg_temp;
alter function public.subscription_payment_is_settled(text) set search_path = public, pg_temp;
alter function public.subscription_tax_invoice_payload(subscription_invoices) set search_path = public, pg_temp;
alter function public.zatca_generate_invoice_uuid() set search_path = public, pg_temp;
alter function public.zatca_generate_ubl_xml(text, uuid, timestamp with time zone, text, text, text, integer, integer, integer, integer, text, integer) set search_path = public, pg_temp;
alter function public.zatca_simplified_invoice_qr(text, text, timestamp with time zone, integer, integer) set search_path = public, pg_temp;
alter function public.zatca_tlv_field(integer, text) set search_path = public, pg_temp;
alter function public.zatca_invoice_hash(text) set search_path = public, extensions, pg_temp;
