-- migration-phase: validate
-- =============================================================================
-- `WR-04` — توثيقُ قيدِ `notification_outbox_kind_check` بعدَ توسيعِه بـ`order_chat_message`
-- في `20261012150000_wr_04_chat_message_notice.sql`. القيدُ مجموعةٌ فائقةٌ للسابقِ، فكلُّ صفٍّ قائمٍ يمرُّ.
-- =============================================================================

alter table notification_outbox validate constraint notification_outbox_kind_check;
