# ADR 0265: إشعارات أطوار الرحلة للراكب في صندوق الصادر الموحَّد

**الحالة:** مقبول.
**التاريخ:** 2026-10-12
**المرجع:** [`ORDER-20261012.md`](../roadmap/execution/ORDER-20261012.md) · [`STATUS.md`](../roadmap/execution/STATUS.md) بند `WR-15` · أمر التنفيذ الملزم للمالك (2026-10-12) · BUG-004 (صندوق الصادر الموحَّد)
**Work Packet:** `docs/work-packets/wr-15-rider-trip-notice-outbox.json`

## السياق

- إشعارات القبول والوصول والبدء والإكمال (`RIDE-NOTICE-01`) كانت تُرسَل من مسار طلب السائق في Mini App مباشرةً بعد الانتقال.
- PR #496 أنهى الابتلاع الصامت بالسجل. لكن سقوط تيليجرام بعد مهلة `withOutboundResilience`، أو انقطاع العملية، كان يُفقد الإشعار بلا صف في القاعدة ولا إعادة.
- أمر المالك يطلب صندوق صادر دائمًا بمفاتيح منع تكرار، ويطلب تسجيل الإنشاء والمحاولة وقبول Telegram والفشل النهائي. ويمنع الخلط بين `delivered` وقبول Telegram API وظهور الإشعار على هاتف المستخدم.

## القرار

1. **نوع جديد في الصندوق القائم، لا صندوق ثانٍ:** `notification_outbox.kind = 'rider_trip_notice'`، ورتبته 1 (حرج)، وسياسته `critical`.
2. **الإيداع:** `enqueue_rider_trip_notice(order, event)`، وهي `security definer` ولـ`service_role` وحده.
   - تنشئ صفًا واحدًا لكل طلب وطور بالمفتاح `rider_trip:<order>:<event>` على الفهرس الفريد القائم `notification_outbox_dedup_uidx (kind, dedup_key)`.
   - تعلن المستقبِل صراحة (`recipient_user_id`).
   - ترفض الطور المجهول (`EVENT_INVALID`).
   - المسار في البوابة يودِع ولا يرسل. عطل الإيداع يُسجَّل (`rider_trip_notice.enqueue_failed`) ولا يحوّل الطور الناجح رفضًا.
3. **الالتقاط:** النوع يُضاف إلى `v_ride_kinds` في `claim_notification_delivery()`.
   - يُلتقط بترتيب الطلب السببي.
   - محادثة الراكب ولغته تُقرآن حيّتين.
   - الراكب بلا محادثة يُعلَن `undeliverable` بـ`TELEGRAM_DELIVERY_UNAVAILABLE`.
   - الإعادة والفشل النهائي (`dead`) بإعداد `notification_delivery_max_attempts` القائم.
4. **الإرسال في العامل** ببوت الراكب: `createRiderTripNoticeHandler`، بالنص والزر نفسيهما (`riderTripText`/`riderTripKeyboard`).
5. **السجل بطبقاته** (بلا معرّف تيليجرام ولا نص):
   - `created` و`deduplicated`: في البوابة.
   - `attempted`: محاولة برقمها.
   - `accepted`: Telegram API قبِل الرسالة وأعاد معرّفها.
   - `send_failed`: فشل تتبعه إعادة.
   - `final_failure`: فشل نهائي، ويُسجَّل خطأً.
   - `undeliverable`: لا محادثة للراكب.
   - `delivered` في الجدول تعني قبول Telegram API. **ولا شيء في النظام يقيس ظهور الإشعار على هاتف الراكب.**

## العواقب

- مسار البوت (قبول السائق من رسالة البوت) ما زال يرسل إشعار القبول مباشرة من `driver-dialog.ts`، ولم يُنقل في هذا البند.
- إشعار «مرشح بانتظار اختيار الراكب» يتبع `WR-09`.
- النشر مقرون: الهجرتان أولًا ثم البوابة. العامل يعمل داخل عملية البوابة في الإنتاج (`RUN_WORKER_IN_GATEWAY=true` في `render.yaml`، ولا خدمة عامل مستقلة)، فنشر البوابة ينشر الإيداع والمعالج معًا. الصفوف التي تسبق النشر تبقى `pending` ولا تضيع.
