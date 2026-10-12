-- migration-phase: index
-- `WR-06` — فهرسُ مُطلِقِ الطلباتِ المجدولة: «ما حانَ إطلاقُه في هذه المدينة؟».
create index concurrently if not exists orders_scheduled_dispatch_idx
  on orders (city_id, dispatch_at)
  where status = 'scheduled';
