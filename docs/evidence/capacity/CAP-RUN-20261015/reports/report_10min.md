# تقرير الدقيقة 10 — 2026-10-15T02:51:18.839Z

- المرحلة: ramp500 · الهدف: 500 · التزامن الفعلي: 500 (الذروة 500) · الزبائن المشغولون: 500
- السائقون حسب الحالة: {"unavailable":111,"idle":853,"accepting":9,"claiming":23,"standby":4}
- HTTP تراكمي: 10073 طلب · نجاح 10072 · غير 2xx 0 · شبكة 1 · p50/p95/p99 = 4.4/64.4/96.8 ms
- آخر 10ث: 0 طلب/ث · p95 0 ms
- الإشعارات (نافذة 10د): أُنشئ 1678 · سُلّم 1625 · أقصى مستحق 78 · أقدم مستحق 129ث
- outbox الآن: {"dead":6743,"pending":27,"delivered":22496,"undeliverable":183} · عروض: {"dead":6743,"pending":16,"delivered":12082}
- تحديثات تيليجرام (نافذة 10د): وارد 7085 · مُعالج 6169 · الآن {"done":92794,"claimed":31,"pending":1001}
- CPU النظام: متوسط 8.3% · p95 14.3% · ذاكرة البوابة القصوى 131.9MB · أقصى اتصالات PG 18 · أقصى PING لـ Redis 7.5ms
- عينات «غير جاهزة»: 13 · انقطاعات رصدها المولّد: 0
- هل الحمل مستمر؟ لا/متوقف

| السيناريو | بدأ | نجح | فشل | الأسباب |
|---|---|---|---|---|
| ride_cancel_searching | 51 | 4 | 33 | order_not_created_45s:31, cancel_status_matched:2 |
| delivery | 357 | 40 | 199 | order_not_created_45s:197, not_completed_in_progress:2 |
| group | 172 | 27 | 39 | agree_not_matched_searching:8, order_not_created_45s:30, group_card_not_delivered_240s:1 |
| delivery_cancel_searching | 32 | 5 | 19 | order_not_created_45s:19 |
| ride | 457 | 51 | 245 | order_not_created_45s:243, not_completed_in_progress:2 |
| delivery_dup_complete | 21 | 5 | 10 | order_not_created_45s:10 |
| delivery_cancel_matched | 30 | 6 | 16 | order_not_created_45s:16 |
| delivery_cancel_in_progress | 13 | 0 | 3 | order_not_created_45s:3 |
| ride_dup_complete | 20 | 1 | 13 | order_not_created_45s:13 |
| ride_cancel_matched | 45 | 2 | 29 | order_not_created_45s:28, cancel_after_match_matched:1 |
| group_overfill | 26 | 3 | 7 | order_not_created_45s:7 |
| ride_cancel_in_progress | 23 | 0 | 10 | order_not_created_45s:10 |
| ride_dup_create | 27 | 3 | 14 | order_not_created_45s:14 |
| group_dup_claim | 10 | 3 | 4 | order_not_created_45s:4 |
| delivery_dup_create | 21 | 4 | 10 | order_not_created_45s:10 |

أخطاء المولّد: {"group_sel_buttons_not_seen":23,"net:TypeError":1,"post_gave_up:group_claim":5,"post_gave_up:driver_location":3,"post_gave_up:driver_unavailable":40,"post_gave_up:rider_menu":60,"post_gave_up:rider_ride_cmd":130,"post_gave_up:group_select":7,"post_gave_up:dup_update":2,"post_gave_up:driver_complete":3,"post_gave_up:driver_available":30,"post_gave_up:rider_cancel":1}
