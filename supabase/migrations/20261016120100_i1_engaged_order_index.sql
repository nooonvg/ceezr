-- migration-phase: index
--
-- `I1` · `ADR 0286` — حائطُ القاعدةِ: فهرسٌ جزئيٌّ فريدٌ على التزامِ السائقِ القائمِ
-- (matched/in_progress): سائقٌ واحدٌ لا يظهرُ ملتزمًا مرتينِ مهما أفلتَ أيُّ مسارِ
-- إسنادٍ منَ الحارسِ في الدوالِّ أو أُضيفَ مستقبلًا. `concurrently` لأنَّ جدولَ
-- الطلباتِ حارٌّ — فالقفلُ الحاجزُ للكتابةِ توقُّفُ خدمةٍ (CAP-007) — ولهذا هو في
-- ملفٍّ وحدَهُ بلا معاملةٍ. التحققُ اللا إتلافيُّ منَ البياناتِ القائمةِ سبقَهُ في
-- `20261016120000_i1_driver_single_engaged_order.sql`.

create unique index concurrently if not exists orders_one_engaged_order_per_driver
  on orders (assigned_driver_id)
  where is_driver_engaged_order_status(status);
