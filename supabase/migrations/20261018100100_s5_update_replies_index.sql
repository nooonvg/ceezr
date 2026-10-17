-- migration-phase: index
-- =============================================================================
-- S5 (ADR 0288) — فهرسُ التقاطِ الردودِ المعلّقةِ: جزئيٌّ على ما يحتاجُ إرسالًا
-- وحدَه (الغالبيةُ الساحقةُ `done`/null فلا تدخلُه)، و`concurrently` كي لا يُحجبَ
-- الجدولُ الحارُّ.
-- =============================================================================

create index concurrently if not exists telegram_update_jobs_reply_due_idx
  on public.telegram_update_jobs (reply_next_attempt_at)
  where reply_status in ('pending', 'sending');
