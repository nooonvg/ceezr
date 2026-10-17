-- العنوان: فهرسُ دورةِ الرحلةِ بمحمولٍ بلا قائمةِ أنواعٍ (LOAD-01 · CAP-20261016-CONTINUATION)
-- المرجع: الشرحُ الكاملُ في 20261017000000_load01_outbox_claim_index.sql — والقاعدةُ القديمةُ
--   (`notification_outbox_ride_cycle_due_idx` على created_at بمحمولِ قائمةِ أنواعٍ) تُتركُ دَينًا معلنًا.
-- migration-phase: index

create index concurrently if not exists notification_outbox_ride_cycle_due_idx2
    on notification_outbox (created_at)
 where status = 'pending';
