-- migration-phase: index
-- ────────────────────────────────────────────────────────────────────────────
-- WR-09 · فهرسُ المرشَّحين الأحياء — شوطُ `expire_order_candidates` يقرأُ ما فاتَ موعدُه
-- من طلباتٍ لها مرشَّح، وهي قلّةٌ في جدولٍ حارّ؛ فالفهرسُ جزئيٌّ عليها وحدَها.
-- طورُ الفهرسِ بلا معاملةٍ (CAP-007).
-- ────────────────────────────────────────────────────────────────────────────

create index concurrently if not exists orders_candidate_expires_idx
  on orders (candidate_expires_at)
  where candidate_driver_id is not null;
