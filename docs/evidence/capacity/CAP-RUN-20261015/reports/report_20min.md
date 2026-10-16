# تقرير الدقيقة 20 — 2026-10-15T03:01:18.933Z

- المرحلة: peak1000 · الهدف: 1000 · التزامن الفعلي: 1000 (الذروة 1000) · الزبائن المشغولون: 999
- السائقون حسب الحالة: {"idle":901,"accepting":38,"unavailable":36,"trip":1,"claiming":20,"standby":4}
- HTTP تراكمي: 50490 طلب · نجاح 30672 · غير 2xx 19817 · شبكة 1 · p50/p95/p99 = 7.9/2004.5/3194.8 ms
- آخر 10ث: 135 طلب/ث · p95 42.8 ms
- الإشعارات (نافذة 10د): أُنشئ 2152 · سُلّم 2160 · أقصى مستحق 229 · أقدم مستحق 239ث
- outbox الآن: {"dead":6759,"delivered":24660,"undeliverable":183} · عروض: {"dead":6759,"delivered":13328}
- تحديثات تيليجرام (نافذة 10د): وارد 20519 · مُعالج 6587 · الآن {"done":99383,"claimed":8,"pending":14993}
- CPU النظام: متوسط 33% · p95 95.4% · ذاكرة البوابة القصوى 139.4MB · أقصى اتصالات PG 22 · أقصى PING لـ Redis 1.48ms
- عينات «غير جاهزة»: 16 · انقطاعات رصدها المولّد: 1
- هل الحمل مستمر؟ نعم

| السيناريو | بدأ | نجح | فشل | الأسباب |
|---|---|---|---|---|
| ride_cancel_searching | 380 | 4 | 344 | order_not_created_45s:335, cancel_status_matched:2, cancel_not_applied_searching:7 |
| delivery | 2760 | 44 | 2481 | order_not_created_45s:2440, not_completed_in_progress:16, not_in_progress_matched:17, no_match_within_wait:8 |
| group | 2384 | 27 | 2105 | agree_not_matched_searching:23, order_not_created_45s:2028, group_card_not_delivered_240s:42, no_claim_registered:12 |
| delivery_cancel_searching | 339 | 5 | 303 | order_not_created_45s:292, cancel_not_applied_searching:9, cancel_status_matched:2 |
| ride | 3431 | 59 | 3093 | order_not_created_45s:3033, not_completed_in_progress:19, not_in_progress_matched:23, no_match_within_wait:18 |
| delivery_dup_complete | 141 | 5 | 126 | order_not_created_45s:122, not_completed_in_progress:1, no_match_within_wait:2, not_in_progress_matched:1 |
| delivery_cancel_matched | 217 | 6 | 190 | order_not_created_45s:185, cancel_after_match_matched:2, no_match_within_wait:3 |
| delivery_cancel_in_progress | 111 | 0 | 99 | order_not_created_45s:99 |
| ride_dup_complete | 181 | 1 | 162 | order_not_created_45s:160, not_in_progress_matched:1, no_match_within_wait:1 |
| ride_cancel_matched | 312 | 2 | 282 | order_not_created_45s:276, cancel_after_match_matched:5, no_match_within_wait:1 |
| group_overfill | 261 | 3 | 231 | order_not_created_45s:221, no_claim_registered:3, group_card_not_delivered_240s:5, agree_not_matched_searching:2 |
| ride_cancel_in_progress | 146 | 0 | 135 | order_not_created_45s:131, not_completed_in_progress:3, no_match_within_wait:1 |
| ride_dup_create | 162 | 3 | 148 | order_not_created_45s:146, not_completed_in_progress:1, not_in_progress_matched:1 |
| group_dup_claim | 171 | 3 | 148 | order_not_created_45s:143, group_card_not_delivered_240s:1, agree_not_matched_searching:3, no_claim_registered:1 |
| delivery_dup_create | 153 | 4 | 137 | order_not_created_45s:136, not_completed_in_progress:1 |

أخطاء المولّد: {"group_sel_buttons_not_seen":27,"net:TypeError":1,"post_gave_up:group_claim":5,"post_gave_up:driver_location":47,"post_gave_up:driver_unavailable":114,"post_gave_up:rider_menu":162,"post_gave_up:rider_ride_cmd":291,"post_gave_up:group_select":7,"post_gave_up:dup_update":6,"post_gave_up:driver_complete":3,"post_gave_up:driver_available":77,"post_gave_up:rider_cancel":32,"post_gave_up:rider_svc_delivery":157,"post_gave_up:rider_pickup":347,"post_gave_up:group_chat":14,"post_gave_up:rider_dropoff":130,"no_free_rider":9389,"no_free_group_rider":286,"http_429:rider_menu":1575,"http_429:rider_dropoff":5129,"http_429:rider_parcel":1819,"http_429:rider_pickup":4930,"http_429:rider_svc_delivery":1660,"http_429:rider_ride_cmd":3048,"http_429:driver_unavailable":139,"http_429:driver_location":718,"http_429:driver_available":134,"http_429:group_select":8,"http_429:group_chat":17,"http_429:group_agree":12,"http_429:rider_cancel":41,"http_429:group_claim":47,"http_429:rider_cancel_dup":11,"http_429:driver_accept":307,"http_429:driver_reject":23,"http_429:driver_start":35,"http_429:driver_complete":18,"http_429:rider_rate":2,"http_429:driver_rate":2,"http_429:rider_cancel_in_trip":1,"http_429:group_claim_dup":3}
