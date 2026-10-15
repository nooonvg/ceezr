# تقرير الدقيقة 40 — 2026-10-15T03:21:19.091Z

- المرحلة: recover150 · الهدف: 150 · التزامن الفعلي: 150 (الذروة 1000) · الزبائن المشغولون: 150
- السائقون حسب الحالة: {"idle":837,"accepting":132,"unavailable":27,"standby":4}
- HTTP تراكمي: 83220 طلب · نجاح 49276 · غير 2xx 33940 · شبكة 4 · p50/p95/p99 = 21.3/1413.1/2530.6 ms
- آخر 10ث: 17.5 طلب/ث · p95 76.7 ms
- الإشعارات (نافذة 10د): أُنشئ 411 · سُلّم 409 · أقصى مستحق 19 · أقدم مستحق 5ث
- outbox الآن: {"dead":6767,"delivered":26413,"undeliverable":187} · عروض: {"dead":6767,"delivered":14522}
- تحديثات تيليجرام (نافذة 10د): وارد 10055 · مُعالج 10030 · الآن {"done":117730,"claimed":18,"pending":14965}
- CPU النظام: متوسط 26.4% · p95 42.8% · ذاكرة البوابة القصوى 132.8MB · أقصى اتصالات PG 22 · أقصى PING لـ Redis 9.17ms
- عينات «غير جاهزة»: 0 · انقطاعات رصدها المولّد: 2
- هل الحمل مستمر؟ نعم

| السيناريو | بدأ | نجح | فشل | الأسباب |
|---|---|---|---|---|
| ride_cancel_searching | 653 | 4 | 645 | order_not_created_45s:632, cancel_status_matched:3, cancel_not_applied_searching:10 |
| delivery | 4579 | 53 | 4481 | order_not_created_45s:4421, not_completed_in_progress:17, not_in_progress_matched:23, no_match_within_wait:20 |
| group | 3568 | 27 | 3519 | agree_not_matched_searching:28, order_not_created_45s:3316, group_card_not_delivered_240s:159, no_claim_registered:16 |
| delivery_cancel_searching | 525 | 5 | 516 | order_not_created_45s:496, cancel_not_applied_searching:13, cancel_status_matched:7 |
| ride | 5654 | 68 | 5534 | order_not_created_45s:5436, not_completed_in_progress:22, not_in_progress_matched:35, no_match_within_wait:41 |
| delivery_dup_complete | 240 | 9 | 225 | order_not_created_45s:221, not_completed_in_progress:1, no_match_within_wait:2, not_in_progress_matched:1 |
| delivery_cancel_matched | 355 | 6 | 348 | order_not_created_45s:341, cancel_after_match_matched:3, no_match_within_wait:4 |
| delivery_cancel_in_progress | 175 | 0 | 173 | order_not_created_45s:172, no_match_within_wait:1 |
| ride_dup_complete | 318 | 1 | 315 | order_not_created_45s:312, not_in_progress_matched:1, no_match_within_wait:2 |
| ride_cancel_matched | 499 | 2 | 495 | order_not_created_45s:485, cancel_after_match_matched:5, no_match_within_wait:5 |
| group_overfill | 397 | 3 | 391 | order_not_created_45s:365, no_claim_registered:3, group_card_not_delivered_240s:21, agree_not_matched_searching:2 |
| ride_cancel_in_progress | 240 | 2 | 237 | order_not_created_45s:231, not_completed_in_progress:3, no_match_within_wait:3 |
| ride_dup_create | 292 | 3 | 286 | order_not_created_45s:281, not_completed_in_progress:1, not_in_progress_matched:1, no_match_within_wait:3 |
| group_dup_claim | 245 | 3 | 241 | order_not_created_45s:230, group_card_not_delivered_240s:7, agree_not_matched_searching:3, no_claim_registered:1 |
| delivery_dup_create | 235 | 4 | 229 | order_not_created_45s:226, not_completed_in_progress:1, duplicate_active_order:2 |

أخطاء المولّد: {"group_sel_buttons_not_seen":28,"net:TypeError":4,"post_gave_up:group_claim":5,"post_gave_up:driver_location":47,"post_gave_up:driver_unavailable":114,"post_gave_up:rider_menu":162,"post_gave_up:rider_ride_cmd":291,"post_gave_up:group_select":7,"post_gave_up:dup_update":6,"post_gave_up:driver_complete":3,"post_gave_up:driver_available":77,"post_gave_up:rider_cancel":32,"post_gave_up:rider_svc_delivery":157,"post_gave_up:rider_pickup":347,"post_gave_up:group_chat":14,"post_gave_up:rider_dropoff":130,"no_free_rider":12798,"no_free_group_rider":404,"http_429:rider_menu":2649,"http_429:rider_dropoff":8635,"http_429:rider_parcel":3010,"http_429:rider_pickup":8385,"http_429:rider_svc_delivery":2783,"http_429:rider_ride_cmd":5236,"http_429:driver_unavailable":338,"http_429:driver_location":1456,"http_429:driver_available":274,"http_429:group_select":9,"http_429:group_chat":23,"http_429:group_agree":15,"http_429:rider_cancel":124,"http_429:group_claim":47,"http_429:rider_cancel_dup":20,"http_429:driver_accept":511,"http_429:driver_reject":48,"http_429:driver_start":52,"http_429:driver_complete":22,"http_429:rider_rate":3,"http_429:driver_rate":3,"http_429:rider_cancel_in_trip":1,"http_429:group_claim_dup":3,"http_503:rider_pickup":1,"http_503:rider_dropoff":1,"http_503:driver_location":1,"board:the database system is shutting down":1}
