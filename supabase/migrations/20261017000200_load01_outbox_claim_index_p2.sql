-- العنوان: إسقاطُ فهرسِ دورةِ الرحلةِ القديمِ لإعادةِ بنائِهِ بمحمولٍ بلا قائمةِ أنواعٍ (LOAD-01 · CAP-20261016-CONTINUATION)
-- المرجع: الشرحُ الكاملُ في 20261017000000_load01_outbox_claim_index.sql
-- migration-phase: index

drop index concurrently if exists notification_outbox_ride_cycle_due_idx;
