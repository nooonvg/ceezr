-- migration-phase: validate
-- =============================================================================
-- S5 (ADR 0288) — مصادقةُ قيدِ حالةِ الردِّ بقفلٍ أخفَّ (`share update exclusive`).
-- =============================================================================

alter table public.telegram_update_jobs
  validate constraint telegram_update_jobs_reply_status_check;
