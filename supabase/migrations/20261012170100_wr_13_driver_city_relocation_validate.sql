-- migration-phase: validate
-- =============================================================================
-- `WR-13` — توثيقُ قيدِ `notification_outbox_kind_check` بعدَ توسيعِه بـ`driver_city_notice`
-- في `20261012170000_wr_13_driver_city_relocation.sql`. القيدُ مجموعةٌ فائقةٌ للسابق.
-- =============================================================================

alter table notification_outbox validate constraint notification_outbox_kind_check;
