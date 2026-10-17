-- العنوان: إعادةُ بناءِ فهرسِ أولويةِ صندوقِ الصادرِ بمحمولٍ بلا قائمةِ أنواعٍ (LOAD-01 · CAP-20261016-CONTINUATION)
-- المرجع: الشرحُ الكاملُ في 20261017000000_load01_outbox_claim_index.sql — الخطةُ العامةُ المعلمةُ
--   لا تُثبتُ فهرسًا بمحمولِ قائمةِ أنواعٍ حرفيةٍ فتسقطهُ (مثبتٌ بخطةٍ عامةٍ: Seq Scan 198ms).
-- migration-phase: index

create index concurrently if not exists notification_outbox_priority_due_idx
    on notification_outbox (notification_kind_priority(kind), created_at)
 where status = 'pending';
