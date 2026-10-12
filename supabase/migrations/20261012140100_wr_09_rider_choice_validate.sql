-- migration-phase: validate
-- =============================================================================
-- `WR-09` — توثيقُ قيدِ `notification_outbox_kind_check` بعدَ توسيعِه بـ`driver_candidate_notice`
-- في `20261012140000_wr_09_rider_choice.sql`. القيدُ مجموعةٌ فائقةٌ للسابقِ، فكلُّ صفٍّ قائمٍ يمرُّ.
-- =============================================================================

alter table notification_outbox validate constraint notification_outbox_kind_check;
