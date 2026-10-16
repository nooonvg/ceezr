# تقرير الدقيقة 30 — 2026-10-15T03:11:19.040Z

- المرحلة: recover150 · الهدف: 150 · التزامن الفعلي: 150 (الذروة 1000) · الزبائن المشغولون: 150
- السائقون حسب الحالة: {"idle":891,"accepting":76,"unavailable":29,"standby":4}
- HTTP تراكمي: 72217 طلب · نجاح 39189 · غير 2xx 33024 · شبكة 4 · p50/p95/p99 = 22.6/1683/2682.4 ms
- آخر 10ث: 13.3 طلب/ث · p95 48.1 ms
- الإشعارات (نافذة 10د): أُنشئ 1476 · سُلّم 1472 · أقصى مستحق 111 · أقدم مستحق 31ث
- outbox الآن: {"dead":6767,"pending":5,"delivered":26004,"undeliverable":185} · عروض: {"dead":6767,"pending":5,"delivered":14171}
- تحديثات تيليجرام (نافذة 10د): وارد 8477 · مُعالج 8567 · الآن {"done":107842,"claimed":15,"pending":14920}
- CPU النظام: متوسط 46.1% · p95 91.6% · ذاكرة البوابة القصوى 136.7MB · أقصى اتصالات PG 22 · أقصى PING لـ Redis 0.87ms
- عينات «غير جاهزة»: 1 · انقطاعات رصدها المولّد: 2
- هل الحمل مستمر؟ نعم

| السيناريو | بدأ | نجح | فشل | الأسباب |
|---|---|---|---|---|
| ride_cancel_searching | 570 | 4 | 560 | order_not_created_45s:548, cancel_status_matched:2, cancel_not_applied_searching:10 |
| delivery | 3983 | 49 | 3893 | order_not_created_45s:3834, not_completed_in_progress:17, not_in_progress_matched:22, no_match_within_wait:20 |
| group | 3329 | 27 | 3276 | agree_not_matched_searching:28, order_not_created_45s:3073, group_card_not_delivered_240s:159, no_claim_registered:16 |
| delivery_cancel_searching | 470 | 5 | 462 | order_not_created_45s:443, cancel_not_applied_searching:13, cancel_status_matched:6 |
| ride | 4976 | 64 | 4856 | order_not_created_45s:4758, not_completed_in_progress:22, not_in_progress_matched:35, no_match_within_wait:41 |
| delivery_dup_complete | 201 | 6 | 194 | order_not_created_45s:190, not_completed_in_progress:1, no_match_within_wait:2, not_in_progress_matched:1 |
| delivery_cancel_matched | 311 | 6 | 301 | order_not_created_45s:294, cancel_after_match_matched:3, no_match_within_wait:4 |
| delivery_cancel_in_progress | 153 | 0 | 151 | order_not_created_45s:150, no_match_within_wait:1 |
| ride_dup_complete | 281 | 1 | 279 | order_not_created_45s:276, not_in_progress_matched:1, no_match_within_wait:2 |
| ride_cancel_matched | 440 | 2 | 436 | order_not_created_45s:426, cancel_after_match_matched:5, no_match_within_wait:5 |
| group_overfill | 370 | 3 | 366 | order_not_created_45s:340, no_claim_registered:3, group_card_not_delivered_240s:21, agree_not_matched_searching:2 |
| ride_cancel_in_progress | 215 | 1 | 213 | order_not_created_45s:207, not_completed_in_progress:3, no_match_within_wait:3 |
| ride_dup_create | 248 | 3 | 244 | order_not_created_45s:239, not_completed_in_progress:1, not_in_progress_matched:1, no_match_within_wait:3 |
| group_dup_claim | 229 | 3 | 223 | order_not_created_45s:212, group_card_not_delivered_240s:7, agree_not_matched_searching:3, no_claim_registered:1 |
| delivery_dup_create | 207 | 4 | 201 | order_not_created_45s:199, not_completed_in_progress:1, duplicate_active_order:1 |

أخطاء المولّد: {"group_sel_buttons_not_seen":28,"net:TypeError":4,"post_gave_up:group_claim":5,"post_gave_up:driver_location":47,"post_gave_up:driver_unavailable":114,"post_gave_up:rider_menu":162,"post_gave_up:rider_ride_cmd":291,"post_gave_up:group_select":7,"post_gave_up:dup_update":6,"post_gave_up:driver_complete":3,"post_gave_up:driver_available":77,"post_gave_up:rider_cancel":32,"post_gave_up:rider_svc_delivery":157,"post_gave_up:rider_pickup":347,"post_gave_up:group_chat":14,"post_gave_up:rider_dropoff":130,"no_free_rider":12798,"no_free_group_rider":404,"http_429:rider_menu":2596,"http_429:rider_dropoff":8413,"http_429:rider_parcel":2904,"http_429:rider_pickup":8192,"http_429:rider_svc_delivery":2713,"http_429:rider_ride_cmd":5156,"http_429:driver_unavailable":304,"http_429:driver_location":1354,"http_429:driver_available":257,"http_429:group_select":9,"http_429:group_chat":23,"http_429:group_agree":15,"http_429:rider_cancel":124,"http_429:group_claim":47,"http_429:rider_cancel_dup":20,"http_429:driver_accept":504,"http_429:driver_reject":47,"http_429:driver_start":51,"http_429:driver_complete":22,"http_429:rider_rate":3,"http_429:driver_rate":3,"http_429:rider_cancel_in_trip":1,"http_429:group_claim_dup":3}
