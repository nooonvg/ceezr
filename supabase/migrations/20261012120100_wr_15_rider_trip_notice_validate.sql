-- migration-phase: validate
-- =============================================================================
-- `WR-15` — توثيقُ قيدِ `notification_outbox_kind_check` بعدَ توسيعِه بـ`rider_trip_notice`
-- في `20261012120000_wr_15_rider_trip_notice_outbox.sql`. القيدُ مجموعةٌ فائقةٌ
-- للسابقِ، فكلُّ صفٍّ قائمٍ يمرُّ.
-- =============================================================================

alter table notification_outbox validate constraint notification_outbox_kind_check;
