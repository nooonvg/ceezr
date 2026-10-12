-- migration-phase: validate
-- =============================================================================
-- `WR-04` — توثيقُ قيدَي نوعِ الرسالةِ وحمولةِ الموقع بعدَ إضافتِهما `not valid` في
-- `20261013000500_wr_04_chat_location_kind.sql`. كلُّ صفٍّ قائمٍ `kind = 'text'`
-- بالافتراض فيمرُّ القيدان.
-- =============================================================================

alter table order_messages validate constraint order_messages_kind_check;
alter table order_messages validate constraint order_messages_location_payload_check;
