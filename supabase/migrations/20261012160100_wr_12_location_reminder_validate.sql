-- migration-phase: validate
-- =============================================================================
-- `WR-12` — توثيقُ قيدِ `notification_outbox_kind_check` بعدَ توسيعِه بـ`driver_location_reminder`
-- في `20261012160000_wr_12_location_reminder.sql`. القيدُ مجموعةٌ فائقةٌ للسابقِ، فكلُّ صفٍّ قائمٍ يمرُّ.
-- =============================================================================

alter table notification_outbox validate constraint notification_outbox_kind_check;
