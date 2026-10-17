-- migration-phase: contract
-- =============================================================================
-- ADR 0287 — تبديلُ قيدَي قناةِ التسليمِ لتقبلَ `miniapp_ack` (إيصالُ حدثِ رحلةٍ
-- منَ Mini App). الحذفُ هنا وحدَه (طورُ العقدِ) كما في 20261017120200.
--
-- القيدانِ الجديدانِ **أوسعُ** لا أضيقُ: كلُّ صفٍّ كانَ يفي بالقديمِ يفي
-- بالجديدِ حرفيًّا (أضيفَتْ قيمةٌ مصرَّحةٌ واحدةٌ). و`not valid` كي لا يُدفعَ
-- قفلُ مسحٍ على الجدولِ الحيِّ — المصادقةُ في 20261018090200 بقفلٍ أخفَّ.
--
-- التراجعُ: إعادةُ القيدينِ الأضيقينِ؛ ولن يُقبلَ إقرارُ Mini App جديدٌ حتى
-- يُوسَّعا ثانيةً — بلا فقدِ بياناتٍ.
-- =============================================================================

alter table public.notification_outbox
  drop constraint if exists notification_outbox_delivered_channel_check;

alter table public.notification_outbox
  add constraint notification_outbox_delivered_channel_check check (
    delivered_channel in ('telegram', 'miniapp_board', 'miniapp_ack')
  ) not valid;

alter table public.notification_outbox
  drop constraint if exists notification_delivered_pair;

alter table public.notification_outbox
  add constraint notification_delivered_pair check (
    (status <> 'delivered')
    or (
      delivered_at is not null
      and (
        delivered_message_id is not null
        or delivered_channel in ('miniapp_board', 'miniapp_ack')
      )
    )
  ) not valid;
