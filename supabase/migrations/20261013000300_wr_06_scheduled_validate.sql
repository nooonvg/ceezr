-- migration-phase: validate
-- `WR-06` — تصديقُ قيدِ «المجدولُ له موعدُ إطلاقٍ وموعدُ حضور» (أُضيفَ `not valid`).
alter table orders validate constraint orders_scheduled_has_times;
