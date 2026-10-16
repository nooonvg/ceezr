# تقرير الدقيقة 50 — 2026-10-15T03:31:19.182Z

- المرحلة: recover150 · الهدف: 150 · التزامن الفعلي: 150 (الذروة 1000) · الزبائن المشغولون: 150
- السائقون حسب الحالة: {"idle":825,"accepting":143,"unavailable":28,"standby":4}
- HTTP تراكمي: 93957 طلب · نجاح 58917 · غير 2xx 35035 · شبكة 5 · p50/p95/p99 = 23.9/1186.4/2530.6 ms
- آخر 10ث: 18.1 طلب/ث · p95 76.7 ms
- الإشعارات (نافذة 10د): أُنشئ 221 · سُلّم 231 · أقصى مستحق 10 · أقدم مستحق 5ث
- outbox الآن: {"dead":6767,"delivered":26624,"undeliverable":188} · عروض: {"dead":6767,"delivered":14670}
- تحديثات تيليجرام (نافذة 10د): وارد 9616 · مُعالج 9553 · الآن {"done":127140,"claimed":8,"pending":14985}
- CPU النظام: متوسط 32.2% · p95 42.3% · ذاكرة البوابة القصوى 132.7MB · أقصى اتصالات PG 17 · أقصى PING لـ Redis 0.65ms
- عينات «غير جاهزة»: 1 · انقطاعات رصدها المولّد: 3
- هل الحمل مستمر؟ نعم

| السيناريو | بدأ | نجح | فشل | الأسباب |
|---|---|---|---|---|
| ride_cancel_searching | 728 | 4 | 717 | order_not_created_45s:704, cancel_status_matched:3, cancel_not_applied_searching:10 |
| delivery | 5149 | 54 | 5055 | order_not_created_45s:4995, not_completed_in_progress:17, not_in_progress_matched:23, no_match_within_wait:20 |
| group | 3818 | 27 | 3768 | agree_not_matched_searching:28, order_not_created_45s:3564, group_card_not_delivered_240s:160, no_claim_registered:16 |
| delivery_cancel_searching | 583 | 5 | 574 | order_not_created_45s:554, cancel_not_applied_searching:13, cancel_status_matched:7 |
| ride | 6335 | 69 | 6217 | order_not_created_45s:6119, not_completed_in_progress:22, not_in_progress_matched:35, no_match_within_wait:41 |
| delivery_dup_complete | 272 | 9 | 261 | order_not_created_45s:257, not_completed_in_progress:1, no_match_within_wait:2, not_in_progress_matched:1 |
| delivery_cancel_matched | 421 | 6 | 408 | order_not_created_45s:401, cancel_after_match_matched:3, no_match_within_wait:4 |
| delivery_cancel_in_progress | 194 | 0 | 192 | order_not_created_45s:191, no_match_within_wait:1 |
| ride_dup_complete | 356 | 1 | 354 | order_not_created_45s:351, not_in_progress_matched:1, no_match_within_wait:2 |
| ride_cancel_matched | 556 | 2 | 553 | order_not_created_45s:543, cancel_after_match_matched:5, no_match_within_wait:5 |
| group_overfill | 427 | 3 | 422 | order_not_created_45s:396, no_claim_registered:3, group_card_not_delivered_240s:21, agree_not_matched_searching:2 |
| ride_cancel_in_progress | 263 | 2 | 261 | order_not_created_45s:255, not_completed_in_progress:3, no_match_within_wait:3 |
| ride_dup_create | 335 | 3 | 328 | order_not_created_45s:323, not_completed_in_progress:1, not_in_progress_matched:1, no_match_within_wait:3 |
| group_dup_claim | 260 | 3 | 254 | order_not_created_45s:243, group_card_not_delivered_240s:7, agree_not_matched_searching:3, no_claim_registered:1 |
| delivery_dup_create | 267 | 4 | 258 | order_not_created_45s:255, not_completed_in_progress:1, duplicate_active_order:2 |

أخطاء المولّد: {"group_sel_buttons_not_seen":28,"net:TypeError":5,"post_gave_up:group_claim":5,"post_gave_up:driver_location":47,"post_gave_up:driver_unavailable":114,"post_gave_up:rider_menu":162,"post_gave_up:rider_ride_cmd":291,"post_gave_up:group_select":7,"post_gave_up:dup_update":6,"post_gave_up:driver_complete":3,"post_gave_up:driver_available":77,"post_gave_up:rider_cancel":32,"post_gave_up:rider_svc_delivery":157,"post_gave_up:rider_pickup":347,"post_gave_up:group_chat":14,"post_gave_up:rider_dropoff":130,"no_free_rider":12798,"no_free_group_rider":404,"http_429:rider_menu":2722,"http_429:rider_dropoff":8872,"http_429:rider_parcel":3133,"http_429:rider_pickup":8588,"http_429:rider_svc_delivery":2880,"http_429:rider_ride_cmd":5317,"http_429:driver_unavailable":370,"http_429:driver_location":1592,"http_429:driver_available":286,"http_429:group_select":9,"http_429:group_chat":23,"http_429:group_agree":15,"http_429:rider_cancel":124,"http_429:group_claim":47,"http_429:rider_cancel_dup":20,"http_429:driver_accept":511,"http_429:driver_reject":48,"http_429:driver_start":52,"http_429:driver_complete":22,"http_429:rider_rate":3,"http_429:driver_rate":3,"http_429:rider_cancel_in_trip":1,"http_429:group_claim_dup":3,"http_503:rider_pickup":1,"http_503:rider_dropoff":1,"http_503:driver_location":13,"board:the database system is shutting down":1,"http_503:driver_unavailable":44,"http_503:rider_ride_cmd":7,"http_503:rider_menu":7,"http_503:driver_available":3}
