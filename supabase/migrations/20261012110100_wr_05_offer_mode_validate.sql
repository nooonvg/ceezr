-- migration-phase: validate
-- WR-05 — مصادقةُ قيدِ سياسةِ المبلغِ في طورٍ تالٍ (القاعدة ٣ في check-migration-safety).
-- الصفوفُ القائمةُ كلُّها `rider_offer_mode is null` فتمرُّ بلا تعديل.
alter table orders validate constraint orders_rider_offer_mode_valid;
