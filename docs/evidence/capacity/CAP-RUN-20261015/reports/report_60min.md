# تقرير الدقيقة 60 — 2026-10-15T03:41:19.213Z

- المرحلة: recover150 · الهدف: 150 · التزامن الفعلي: 150 (الذروة 1000) · الزبائن المشغولون: 150
- السائقون حسب الحالة: {"idle":819,"accepting":148,"unavailable":29,"standby":4}
- HTTP تراكمي: 104529 طلب · نجاح 67778 · غير 2xx 36745 · شبكة 6 · p50/p95/p99 = 26.9/1055.9/2387.3 ms
- آخر 10ث: 24 طلب/ث · p95 154.4 ms
- الإشعارات (نافذة 10د): أُنشئ 192 · سُلّم 191 · أقصى مستحق 11 · أقدم مستحق 7ث
- outbox الآن: {"dead":6767,"delivered":26814,"undeliverable":189} · عروض: {"dead":6767,"delivered":14786}
- تحديثات تيليجرام (نافذة 10د): وارد 8816 · مُعالج 8835 · الآن {"done":135834,"claimed":29,"pending":14969}
- CPU النظام: متوسط 35% · p95 42.7% · ذاكرة البوابة القصوى 126.7MB · أقصى اتصالات PG 17 · أقصى PING لـ Redis 385.15ms
- عينات «غير جاهزة»: 1 · انقطاعات رصدها المولّد: 4
- هل الحمل مستمر؟ نعم

| السيناريو | بدأ | نجح | فشل | الأسباب |
|---|---|---|---|---|
| ride_cancel_searching | 800 | 4 | 791 | order_not_created_45s:778, cancel_status_matched:3, cancel_not_applied_searching:10 |
| delivery | 5718 | 54 | 5608 | order_not_created_45s:5547, not_completed_in_progress:17, not_in_progress_matched:23, no_match_within_wait:21 |
| group | 4066 | 27 | 4024 | agree_not_matched_searching:28, order_not_created_45s:3815, group_card_not_delivered_240s:165, no_claim_registered:16 |
| delivery_cancel_searching | 653 | 5 | 644 | order_not_created_45s:624, cancel_not_applied_searching:13, cancel_status_matched:7 |
| ride | 7026 | 70 | 6910 | order_not_created_45s:6812, not_completed_in_progress:22, not_in_progress_matched:35, no_match_within_wait:41 |
| delivery_dup_complete | 300 | 9 | 290 | order_not_created_45s:286, not_completed_in_progress:1, no_match_within_wait:2, not_in_progress_matched:1 |
| delivery_cancel_matched | 466 | 6 | 454 | order_not_created_45s:447, cancel_after_match_matched:3, no_match_within_wait:4 |
| delivery_cancel_in_progress | 222 | 0 | 220 | order_not_created_45s:219, no_match_within_wait:1 |
| ride_dup_complete | 401 | 1 | 398 | order_not_created_45s:395, not_in_progress_matched:1, no_match_within_wait:2 |
| ride_cancel_matched | 594 | 2 | 587 | order_not_created_45s:576, cancel_after_match_matched:6, no_match_within_wait:5 |
| group_overfill | 456 | 3 | 451 | order_not_created_45s:425, no_claim_registered:3, group_card_not_delivered_240s:21, agree_not_matched_searching:2 |
| ride_cancel_in_progress | 289 | 2 | 286 | order_not_created_45s:280, not_completed_in_progress:3, no_match_within_wait:3 |
| ride_dup_create | 378 | 3 | 373 | order_not_created_45s:368, not_completed_in_progress:1, not_in_progress_matched:1, no_match_within_wait:3 |
| group_dup_claim | 278 | 3 | 273 | order_not_created_45s:262, group_card_not_delivered_240s:7, agree_not_matched_searching:3, no_claim_registered:1 |
| delivery_dup_create | 294 | 4 | 289 | order_not_created_45s:286, not_completed_in_progress:1, duplicate_active_order:2 |

أخطاء المولّد: {"group_sel_buttons_not_seen":28,"net:TypeError":6,"post_gave_up:group_claim":5,"post_gave_up:driver_location":47,"post_gave_up:driver_unavailable":114,"post_gave_up:rider_menu":162,"post_gave_up:rider_ride_cmd":291,"post_gave_up:group_select":7,"post_gave_up:dup_update":6,"post_gave_up:driver_complete":3,"post_gave_up:driver_available":77,"post_gave_up:rider_cancel":32,"post_gave_up:rider_svc_delivery":157,"post_gave_up:rider_pickup":347,"post_gave_up:group_chat":14,"post_gave_up:rider_dropoff":130,"no_free_rider":12798,"no_free_group_rider":404,"http_429:rider_menu":2817,"http_429:rider_dropoff":9291,"http_429:rider_parcel":3319,"http_429:rider_pickup":8968,"http_429:rider_svc_delivery":3010,"http_429:rider_ride_cmd":5493,"http_429:driver_unavailable":428,"http_429:driver_location":1775,"http_429:driver_available":319,"http_429:group_select":9,"http_429:group_chat":23,"http_429:group_agree":15,"http_429:rider_cancel":124,"http_429:group_claim":47,"http_429:rider_cancel_dup":20,"http_429:driver_accept":519,"http_429:driver_reject":48,"http_429:driver_start":52,"http_429:driver_complete":22,"http_429:rider_rate":3,"http_429:driver_rate":3,"http_429:rider_cancel_in_trip":1,"http_429:group_claim_dup":3,"http_503:rider_pickup":1,"http_503:rider_dropoff":1,"http_503:driver_location":13,"board:the database system is shutting down":1,"http_503:driver_unavailable":44,"http_503:rider_ride_cmd":7,"http_503:rider_menu":7,"http_503:driver_available":3}
