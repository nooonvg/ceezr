-- migration-phase: validate
-- =============================================================================
-- ADR 0287 — مصادقةُ القيدينِ الأوسعينِ (20261018090100) بقفلٍ أخفَّ
-- (`share update exclusive`) لا يحجبُ الكتابةَ.
-- =============================================================================

alter table public.notification_outbox
  validate constraint notification_outbox_delivered_channel_check;

alter table public.notification_outbox
  validate constraint notification_delivered_pair;
