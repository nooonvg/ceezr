# قياساتُ سجلِّ البوابةِ — تشخيصاتُ r12 (موجة 500)

مستخرَجةٌ آليًّا من شرائحِ `gateway.log` لكلِّ تشغيلٍ (من آخرِ `gateway.started`). السجلّاتُ الخامُ لا تُلتزَمُ؛ الأرقامُ هنا هي المقيسُ نفسُه.

## diag-r12-neworder-500

```text
dispatch.new_order_broadcast: 3029
redispatch.immediate_in_flight: 1666
redispatch.immediate_debounced: 1410
redispatch.rebroadcast: 761
telegram.drainer.sweep_completed: 55
dispatch.new_order_not_broadcast: 48
telegram.drainer.sweep_cap_reached: 26
dispatch.no_eligible_driver: 3
```

## diag-r12-timing-500

```text
dispatch.new_order_broadcast: 1908
redispatch.immediate_in_flight: 1066
redispatch.immediate_debounced: 883
redispatch.rebroadcast: 428
dispatch.new_order_not_broadcast: 42
telegram.drainer.sweep_completed: 20
telegram.drainer.sweep_cap_reached: 19
dispatch.no_eligible_driver: 4
dispatch.new_order_broadcast.queuedMs: n=1908 p50=11764 p95=20098
dispatch.new_order_broadcast.tookMs: n=1908 p50=202 p95=542
dispatch.new_order_not_broadcast.queuedMs: n=42 p50=10431 p95=20124
dispatch.new_order_not_broadcast.tookMs: n=42 p50=278 p95=519
```

## diag-r12-conc12-500

```text
redispatch.rebroadcast: 2679
dispatch.new_order_broadcast: 2089
redispatch.immediate_in_flight: 1361
redispatch.immediate_debounced: 729
telegram.drainer.sweep_completed: 260
telegram.drainer.sweep_cap_reached: 8
dispatch.no_eligible_driver: 2
dispatch.new_order_not_broadcast: 2
dispatch.new_order_broadcast.queuedMs: n=2089 p50=0 p95=564
dispatch.new_order_broadcast.tookMs: n=2089 p50=227 p95=564
dispatch.new_order_not_broadcast.queuedMs: n=2 p50=0 p95=0
dispatch.new_order_not_broadcast.tookMs: n=2 p50=39 p95=39
```

## diag-r12-nearby-500

```text
dispatch.new_order_broadcast: 2103
dispatch.nearby_broadcast: 2056
redispatch.immediate_debounced: 1765
redispatch.immediate_in_flight: 1101
dispatch.nearby_not_broadcast: 811
dispatch.new_order_not_broadcast: 764
redispatch.rebroadcast: 485
telegram.drainer.sweep_completed: 46
telegram.drainer.sweep_cap_reached: 45
dispatch.no_eligible_driver: 8
dispatch.new_order_broadcast.queuedMs: n=2103 p50=959 p95=2463
dispatch.new_order_broadcast.tookMs: n=2103 p50=332 p95=528
dispatch.new_order_not_broadcast.queuedMs: n=764 p50=1263 p95=5082
dispatch.new_order_not_broadcast.tookMs: n=764 p50=136 p95=447
nearby_broadcast.includesDriver: 1236/2056
```

## diag-r12-nearby4-500

```text
dispatch.new_order_not_broadcast: 2715
dispatch.nearby_broadcast: 2303
redispatch.immediate_in_flight: 2046
redispatch.rebroadcast: 1253
redispatch.immediate_debounced: 804
telegram.drainer.sweep_completed: 168
dispatch.new_order_broadcast: 136
dispatch.nearby_not_broadcast: 59
telegram.drainer.sweep_cap_reached: 15
dispatch.no_eligible_driver: 4
dispatch.new_order_broadcast.queuedMs: n=136 p50=1946 p95=49973
dispatch.new_order_broadcast.tookMs: n=136 p50=149 p95=399
dispatch.new_order_not_broadcast.queuedMs: n=2715 p50=51949 p95=73257
dispatch.new_order_not_broadcast.tookMs: n=2715 p50=29 p95=90
nearby_broadcast.includesDriver: 65/2303
```

## diag-r12-arrival8-500

```text
redispatch.immediate_debounced: 3609
dispatch.nearby_task: 3289
dispatch.nearby_broadcast: 3163
redispatch.immediate_in_flight: 2968
redispatch.rebroadcast: 850
dispatch.nearby_not_broadcast: 126
telegram.drainer.sweep_completed: 45
telegram.drainer.sweep_cap_reached: 44
dispatch.no_eligible_driver: 1
dispatch.nearby_task.queuedMs: n=3289 p50=129 p95=1082
dispatch.nearby_task.tookMs: n=3289 p50=374 p95=670
nearby_broadcast.includesDriver: 3133/3163
```

## diag-r12-jobtiming-500

```text
telegram.drainer.diag_claim: 4466
telegram.drainer.diag_timing: 4463
telegram.drainer.diag_job: 4463
redispatch.immediate_debounced: 3378
dispatch.nearby_task: 3255
redispatch.immediate_in_flight: 3131
dispatch.nearby_broadcast: 3116
redispatch.rebroadcast: 849
dispatch.nearby_not_broadcast: 139
telegram.drainer.sweep_completed: 45
telegram.drainer.sweep_cap_reached: 44
dispatch.no_eligible_driver: 1
dispatch.nearby_task.queuedMs: n=3255 p50=193 p95=5535
dispatch.nearby_task.tookMs: n=3255 p50=372 p95=708
nearby_broadcast.includesDriver: 2974/3116
telegram.drainer.diag_claim.claimMs: n=4466 p50=38 p95=103
telegram.drainer.diag_claim.inflight: n=4466 p50=4 p95=5
telegram.drainer.diag_job.laneWaitMs: n=4463 p50=0 p95=0
telegram.drainer.diag_job.totalMs: n=4463 p50=167 p95=385
telegram.drainer.diag_timing.prepareMs: n=4463 p50=82 p95=201
telegram.drainer.diag_timing.recordMs: n=4463 p50=39 p95=102
```

## diag-r12-batchclaim-500

```text
redispatch.immediate_in_flight: 4546
telegram.drainer.diag_claim: 2984
telegram.drainer.diag_timing: 2676
telegram.drainer.diag_job: 2676
dispatch.nearby_task: 2676
dispatch.nearby_broadcast: 2574
redispatch.immediate_debounced: 805
redispatch.rebroadcast: 803
telegram.drainer.sweep_completed: 276
dispatch.nearby_not_broadcast: 102
telegram.drainer.sweep_cap_reached: 5
dispatch.no_eligible_driver: 1
dispatch.nearby_task.queuedMs: n=2676 p50=38890 p95=41276
dispatch.nearby_task.tookMs: n=2676 p50=537 p95=1224
nearby_broadcast.includesDriver: 1279/2574
telegram.drainer.diag_claim.claimMs: n=2984 p50=0 p95=187
telegram.drainer.diag_claim.inflight: n=2984 p50=5 p95=26
telegram.drainer.diag_job.laneWaitMs: n=2676 p50=0 p95=0
telegram.drainer.diag_job.totalMs: n=2676 p50=394 p95=795
telegram.drainer.diag_timing.prepareMs: n=2676 p50=199 p95=404
telegram.drainer.diag_timing.recordMs: n=2676 p50=96 p95=214
```

## diag-r12-looplag-500

```text
redispatch.immediate_in_flight: 4581
telegram.drainer.diag_claim: 2963
telegram.drainer.diag_timing: 2666
telegram.drainer.diag_job: 2666
dispatch.nearby_task: 2666
dispatch.nearby_broadcast: 2533
redispatch.rebroadcast: 803
redispatch.immediate_debounced: 750
telegram.drainer.sweep_completed: 269
dispatch.nearby_not_broadcast: 126
diag.loop_lag: 48
telegram.drainer.sweep_cap_reached: 5
diag.loop_lag.p50: n=48 p50=1 p95=2
dispatch.nearby_task.queuedMs: n=2666 p50=39179 p95=43458
dispatch.nearby_task.tookMs: n=2666 p50=541 p95=1164
nearby_broadcast.includesDriver: 1227/2533
telegram.drainer.diag_claim.claimMs: n=2963 p50=0 p95=194
telegram.drainer.diag_claim.inflight: n=2963 p50=5 p95=26
telegram.drainer.diag_job.laneWaitMs: n=2666 p50=0 p95=0
telegram.drainer.diag_job.totalMs: n=2666 p50=414 p95=802
telegram.drainer.diag_timing.prepareMs: n=2666 p50=206 p95=409
telegram.drainer.diag_timing.recordMs: n=2666 p50=101 p95=214
```

## diag-r12-pool-500

```text
redispatch.immediate_in_flight: 4433
telegram.drainer.diag_claim: 2973
telegram.drainer.diag_timing: 2670
telegram.drainer.diag_job: 2670
dispatch.nearby_task: 2670
dispatch.nearby_broadcast: 2565
redispatch.immediate_debounced: 906
redispatch.rebroadcast: 801
telegram.drainer.sweep_completed: 275
dispatch.nearby_not_broadcast: 105
diag.loop_lag: 52
diag.pool_probe: 26
diag.loop_lag.p50: n=52 p50=1 p95=1
diag.pool_probe.p50: n=26 p50=99 p95=151
dispatch.nearby_task.queuedMs: n=2670 p50=37058 p95=40589
dispatch.nearby_task.tookMs: n=2670 p50=541 p95=1136
nearby_broadcast.includesDriver: 1298/2565
telegram.drainer.diag_claim.claimMs: n=2973 p50=0 p95=185
telegram.drainer.diag_claim.inflight: n=2973 p50=5 p95=26
telegram.drainer.diag_job.laneWaitMs: n=2670 p50=0 p95=0
telegram.drainer.diag_job.totalMs: n=2670 p50=390 p95=851
telegram.drainer.diag_timing.prepareMs: n=2670 p50=196 p95=438
telegram.drainer.diag_timing.recordMs: n=2670 p50=95 p95=206
```

## diag-r12-nearby16-500

```text
redispatch.immediate_in_flight: 4669
telegram.drainer.diag_claim: 2818
telegram.drainer.diag_timing: 2697
telegram.drainer.diag_job: 2697
dispatch.nearby_task: 2697
dispatch.nearby_broadcast: 2604
redispatch.immediate_debounced: 724
redispatch.rebroadcast: 683
telegram.drainer.sweep_completed: 118
dispatch.nearby_not_broadcast: 93
diag.loop_lag: 46
diag.pool_probe: 23
diag.loop_lag.p50: n=46 p50=1 p95=1
diag.pool_probe.p50: n=23 p50=171 p95=244
dispatch.nearby_task.queuedMs: n=2697 p50=27392 p95=34705
dispatch.nearby_task.tookMs: n=2697 p50=1157 p95=1781
nearby_broadcast.includesDriver: 1467/2604
telegram.drainer.diag_claim.claimMs: n=2818 p50=0 p95=252
telegram.drainer.diag_claim.inflight: n=2818 p50=11 p95=27
telegram.drainer.diag_job.laneWaitMs: n=2697 p50=0 p95=0
telegram.drainer.diag_job.totalMs: n=2697 p50=653 p95=1084
telegram.drainer.diag_timing.prepareMs: n=2697 p50=323 p95=536
telegram.drainer.diag_timing.recordMs: n=2697 p50=159 p95=288
```

## diag-r12-psa-500 — عيّناتُ `pg_stat_activity` منتصفَ الموجة (أربعُ عيّناتٍ كلَّ 3ث)

الأعمدة: application_name | state | wait_event | الاستعلام (مقصوصًا) | العدد. `postgres.js` = تجمّعُ البوابةِ (15)؛ `genA` و`driver-onboarding` = المولّد.

```text
FRESH_DB_OK gateway_pid=18915
genA|idle|ClientRead| select status::text as status, assigned_driver_id::text as assigned from orders where id |4
driver-onboarding|idle|ClientRead| select status from telegram_update_jobs where bot = 'driver' and update_id = $1::bigint |3
postgres.js|idle|ClientRead| select pg_advisory_unlock($1::int, $2::int) |3
genA|idle|ClientRead| select id::text, status::text, driver_id::text, round, created_at::text, expires_at::text|2
postgres.js|active|ClientRead|select role::text as role, is_blocked, language_code from users where telegram_id = $1|2
genA|idle|ClientRead| select status::text, attempts, delivered_at::text from notification_outbox where order_id|2
postgres.js|idle|ClientRead| select list_rider_trip_events($1::bigint, $2::uuid) as result|1
postgres.js|idle|ClientRead| select pg_try_advisory_lock($1::int, $2::int) as locked |1
postgres.js|idle|ClientRead| select request_id from notification_outbox where id = $1::uuid |1
driver-onboarding|idle|ClientRead| select id::text as id from cities where code = $1 |1
postgres.js|idle|ClientRead|select claim_notification_delivery() result|1
postgres.js|active|-|select claim_notification_delivery() result|1
postgres.js|active|ClientRead|select requeue_notification_delivery_signal_wait( $1::uuid, $2::uuid, $3::integer) result|1
postgres.js|idle|ClientRead| select acked_at from rider_trip_event_receipts where delivery_id = $1::uuid|1
---
genA|idle|ClientRead| select status::text as status, assigned_driver_id::text as assigned from orders where id |4
postgres.js|idle|ClientRead| select pg_advisory_unlock($1::int, $2::int) |3
genA|idle|ClientRead| select id::text, status::text, driver_id::text, round, created_at::text, expires_at::text|2
postgres.js|idle|ClientRead| select d.id as driver_id, d.city_id, u.telegram_id, u.full_name, u.phone, d.verification_|2
postgres.js|idle|ClientRead|commit|2
genA|idle|ClientRead| select status::text, attempts, delivered_at::text from notification_outbox where order_id|2
postgres.js|idle|ClientRead| select driver_offer_board($1::bigint) as result|1
postgres.js|idle|ClientRead| select id from orders where assigned_driver_id = $1::uuid and status in ('matched', 'in_p|1
postgres.js|idle|ClientRead| select pg_try_advisory_lock($1::int, $2::int) as locked |1
postgres.js|idle|ClientRead| select request_id from notification_outbox where id = $1::uuid |1
driver-onboarding|idle|ClientRead| insert into driver_capabilities (city_id, driver_id, service) values ($1::uuid, $2::uuid,|1
postgres.js|idle|ClientRead|select claim_notification_delivery() result|1
driver-onboarding|idle|ClientRead| select d.verification_status::text verification, exists(select 1 from driver_capabilities|1
driver-onboarding|idle|ClientRead| select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select 1 |1
---
driver-onboarding|idle|ClientRead| select status from telegram_update_jobs where bot = 'driver' and update_id = $1::bigint |4
postgres.js|idle|ClientRead| select pg_advisory_unlock($1::int, $2::int) |3
genA|idle|ClientRead| insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((|3
genA|idle|ClientRead| insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2|3
postgres.js|idle|ClientRead| select d.verification_status::text as verification_status, d.last_location is not null as|2
genA|idle|ClientRead| select status::text as status, assigned_driver_id::text as assigned from orders where id |2
postgres.js|idle|ClientRead| select request_id from notification_outbox where id = $1::uuid |2
postgres.js|idle|-| select driver_offer_board($1::bigint) as result|1
postgres.js|active|ClientRead| select list_rider_trip_events($1::bigint, $2::uuid) as result|1
postgres.js|idle|ClientRead| select pg_try_advisory_lock($1::int, $2::int) as locked |1
postgres.js|idle|ClientRead|select claim_notification_delivery() result|1
postgres.js|idle|ClientRead| with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, rec|1
postgres.js|idle|ClientRead|commit|1
postgres.js|idle|ClientRead| select acked_at from rider_trip_event_receipts where delivery_id = $1::uuid|1
---
genA|idle|ClientRead| select status::text as status, assigned_driver_id::text as assigned from orders where id |4
postgres.js|idle|ClientRead| select pg_advisory_unlock($1::int, $2::int) |2
postgres.js|idle|ClientRead| select pg_try_advisory_lock($1::int, $2::int) as locked |2
postgres.js|idle|ClientRead|select kind, version, accepted_at from list_user_consents($1)|2
genA|idle|ClientRead| insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2|2
genA|idle|ClientRead| insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((|2
postgres.js|active|ClientRead|select role::text as role, is_blocked, language_code from users where telegram_id = $1|1
postgres.js|idle|ClientRead| select acked_at from rider_trip_event_receipts where delivery_id = $1::uuid|1
postgres.js|idle|ClientRead| select driver_offer_board($1::bigint) as result|1
postgres.js|idle|ClientRead| select order_id, driver_id, status, created_at, round from order_offers where order_id = |1
postgres.js|idle|ClientRead|select claim_notification_delivery() result|1
postgres.js|idle|ClientRead|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result|1
|active|-|autovacuum: VACUUM ANALYZE public.notification_outbox|1
postgres.js|idle|ClientRead|select role::text as role, is_blocked, language_code from users where telegram_id = $1|1
---
```

## آلةُ الاختبار أثناءَ diag-r12-looplag-500 (`vmstat 5`: us sy id wa st)

```text
23 5 72 0 0
59 18 22 0 1
63 14 23 0 1
66 13 20 0 1
70 12 17 0 1
65 14 21 0 1
71 11 17 0 1
70 11 18 0 0
74 11 14 0 0
69 11 19 0 1
73 12 15 0 0
74 11 15 0 1
75 12 13 0 0
77 13 10 0 0
61 13 24 0 1
61 14 25 0 1
69 12 18 0 1
82 11 6 0 1
63 13 23 0 1
65 13 21 0 1
70 12 16 0 1
81 12 6 0 1
70 13 17 0 1
62 14 23 0 1
69 12 18 0 0
63 13 23 0 1
63 14 22 0 1
65 13 21 0 0
65 12 22 0 1
64 13 21 0 1
65 12 22 0 0
65 13 22 0 1
66 12 22 0 1
64 12 23 0 1
63 13 23 0 1
63 13 23 0 1
72 12 16 0 0
67 12 20 0 1
66 13 20 0 1
71 11 17 0 0
75 10 15 0 0
31 6 61 0 1
20 5 74 0 1
15 3 81 0 0
20 5 75 0 0
6 2 91 0 1
2 1 97 0 1
2 1 97 0 0
8 1 91 0 0
15 8 78 0 0
1 1 98 0 0
1 1 98 0 0
1 0 98 0 0
1 1 99 0 0
1 1 98 0 0
1 1 97 1 0
1 1 98 0 0
1 1 99 0 0
1 1 98 0 0
1 1 98 0 0
3 1 96 0 0
1 0 98 0 0
1 1 98 0 0
1 1 98 0 0
1 1 98 0 0
1 1 99 0 0
1 1 98 0 0
1 1 98 0 0
2 1 98 0 0
1 1 98 0 0
1 1 98 0 0
1 1 98 0 0
3 1 96 0 1
1 1 98 0 0
1 1 98 0 0
1 1 98 0 0
1 1 98 0 0
1 1 98 0 0
1 1 98 0 0
1 1 98 0 0
1 1 98 0 0
1 0 99 0 0
1 0 98 0 0
1 1 98 0 0
3 1 96 0 0
```

## diag-r12-offersignal-500

```text
redispatch.immediate_in_flight: 4079
dispatch.nearby_task: 2452
dispatch.nearby_broadcast: 2237
redispatch.immediate_debounced: 824
redispatch.rebroadcast: 780
dispatch.nearby_not_broadcast: 90
dispatch.nearby_task.queuedMs: n=2452 p50=43462 p95=51017
dispatch.nearby_task.tookMs: n=2452 p50=647 p95=1127
nearby_broadcast.includesDriver: 1112/2237
```

## diag-r12-nocityrun-500

```text
dispatch.nearby_task: 2543
dispatch.nearby_broadcast: 2023
dispatch.new_order_not_broadcast: 1926
dispatch.new_order_broadcast: 617
redispatch.rebroadcast: 460
dispatch.nearby_not_broadcast: 110
dispatch.no_eligible_driver: 10
dispatch.nearby_task.queuedMs: n=2543 p50=63735 p95=74978
dispatch.nearby_task.tookMs: n=2543 p50=421 p95=1001
nearby_broadcast.includesDriver: 201/2023
```
