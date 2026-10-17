-- العنوان: إعادةُ بناءِ فهرسِ دورةِ الرحلةِ بمحمولٍ بلا قائمةِ أنواعٍ (LOAD-01 · CAP-20261016-CONTINUATION)
-- المرجع: الشرحُ الكاملُ في 20261017000000_load01_outbox_claim_index.sql
-- migration-phase: index

create index concurrently if not exists notification_outbox_ride_cycle_due_idx
    on notification_outbox (created_at)
 where status = 'pending';
