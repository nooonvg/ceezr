-- migration-phase: expand
-- =============================================================================
-- `WR-10` — إغلاقُ بطاقةِ قروبِ غيرِ المشتركينَ بعدَ انتهاءِ دورتِها.
--
-- **المقيسُ (2026-10-12، قراءةٌ فقط):** ستُّ دوراتٍ في الإنتاجِ حالتُها `cancelled`، ولكلٍّ
-- منها `group_message_id`. ولا شيفرةَ تعدّلُ البطاقةَ بعدَ نشرِها، فتبقى بزرِّ «قبول» كأنَّ
-- الطلبَ متاح. والخادمُ يرفضُ الضغطةَ (`NEGOTIATION_CLOSED`)، لكنَّ البطاقةَ تكذب.
--
-- **القرار:** عمودانِ فقط، بلا دالّةٍ ولا صلاحيّة:
--   ١) `group_card_closed_at`: متى كُتبَ المآلُ على البطاقةِ وأُزيلَ زرُّها.
--   ٢) `group_card_close_attempts`: عدّادُ محاولاتِ التعديلِ الفاشلة. الشوطُ يكفُّ بعدَ حدٍّ
--      في الشيفرة، فلا يعيدُ إلى الأبد على رسالةٍ لا تُعدَّل.
-- وشوطُ `rotate-negotiations` القائمُ في كلِّ مدينةٍ يلتقطُ الدوراتِ المغلقةَ ذاتَ البطاقةِ
-- غيرِ المغلقة، فيعدّلُها ثمَّ يعلّمُها.
--
-- **الدوراتُ القديمةُ:** تُعلَّمُ مغلقةً هنا دونَ تعديلِ رسائلِها. فالنشرُ لا يمسُّ بطاقاتٍ
-- قديمةً في القروبِ الحقيقيِّ (أمرُ المالكِ §10: لا إزعاجَ لأعضاءِ المجموعة). وإغلاقُها
-- لاحقًا قرارُ تشغيلٍ: `update unsubscribed_negotiations set group_card_closed_at = null where ...`.
--
-- **العودة:** حذفُ العمودينِ والفهرس. والشيفرةُ السابقةُ لا تقرؤُهما.
-- =============================================================================

alter table unsubscribed_negotiations
  add column if not exists group_card_closed_at timestamptz,
  add column if not exists group_card_close_attempts integer not null default 0;

update unsubscribed_negotiations
   set group_card_closed_at = now()
 where group_card_closed_at is null
   and status not in ('collecting', 'negotiating');

create index if not exists unsubscribed_negotiations_open_card_idx
  on unsubscribed_negotiations (city_id)
  where group_message_id is not null and group_card_closed_at is null;
