# b10-acc-500 — تفكيكُ انتظارِ وظائفِ تحديثاتِ تيليجرام (من قاعدةِ الموجةِ بعدَ انتهائها)

```sql
select bot, count(*), status from telegram_update_jobs group by 1,3 order by 1;
with j as (select bot, extract(epoch from (coalesce(effect_recorded_at,completed_at)-created_at))*1000 ms, date_trunc('minute',created_at)+ (floor(extract(second from created_at)/15)*15)*interval '1 second' b from telegram_update_jobs where created_at > now() - interval '3 hours')
select bot, b, count(*), round(percentile_cont(0.5) within group (order by ms)) p50, round(percentile_cont(0.95) within group (order by ms)) p95, round(max(ms)) mx from j group by 1,2 order by 1,2;
select count(*) filter (where claimed_at is null) null_claimed, count(*) filter (where effect_recorded_at is null) null_eff, count(*) filter (where completed_at is null) null_done from telegram_update_jobs;
select round(percentile_cont(0.5) within group (order by a)) created_to_effect_p50, round(percentile_cont(0.95) within group (order by a)) p95,
 round(percentile_cont(0.5) within group (order by b)) effect_to_done_p50, round(percentile_cont(0.95) within group (order by b)) p95b
from (select extract(epoch from effect_recorded_at-created_at)*1000 a, extract(epoch from completed_at-effect_recorded_at)*1000 b from telegram_update_jobs) x;
```

```
  bot   | count | status 
--------+-------+--------
 driver |  3798 | done
(1 row)

  bot   |           b            | count |  p50  |  p95  |  mx   
--------+------------------------+-------+-------+-------+-------
 driver | 2026-10-18 15:27:00+00 |   584 |  3897 | 10963 | 12559
 driver | 2026-10-18 15:27:15+00 |   281 |  8105 | 11454 | 12274
 driver | 2026-10-18 15:27:30+00 |   359 | 13772 | 17344 | 17728
 driver | 2026-10-18 15:27:45+00 |   314 | 17181 | 19404 | 19535
 driver | 2026-10-18 15:28:00+00 |   267 | 19073 | 20348 | 20630
 driver | 2026-10-18 15:28:15+00 |   330 | 15373 | 17778 | 18323
 driver | 2026-10-18 15:28:30+00 |   265 | 17492 | 19030 | 19335
 driver | 2026-10-18 15:28:45+00 |   253 | 16324 | 18105 | 18385
 driver | 2026-10-18 15:29:00+00 |   287 | 16775 | 17541 | 17649
 driver | 2026-10-18 15:29:15+00 |   301 | 19061 | 20500 | 20907
 driver | 2026-10-18 15:29:30+00 |   265 | 15725 | 16835 | 19362
 driver | 2026-10-18 15:29:45+00 |   235 | 18177 | 19621 | 19882
 driver | 2026-10-18 15:30:00+00 |    57 | 13603 | 13851 | 14073
(13 rows)

 null_claimed | null_eff | null_done 
--------------+----------+-----------
         3798 |        0 |         0
(1 row)

 created_to_effect_p50 |  p95  | effect_to_done_p50 | p95b 
-----------------------+-------+--------------------+------
                 15991 | 19497 |                  0 |    0
(1 row)

```
