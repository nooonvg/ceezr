-- migration-phase: expand
-- =============================================================================
-- `WR-22` (ADR 0278) — إغلاقُ بطاقةِ الإسنادِ حينَ يصلُ الطلبُ حالًا لا رجعةَ عنها.
--
-- **المقيسُ (2026-10-13، قراءةٌ فقط):** ثلاثُ بطاقاتِ إسنادٍ مسلَّمةٍ في الإنتاج، ولكلٍّ منها
-- `message_id` في أثرِ `order.escalated`، وطلباتُها `completed` و`cancelled` و`failed`
-- (`4d67e20f`، انتهى بحثُه). ولا شيفرةَ تعدّلُ البطاقةَ بعدَ نشرِها، فتبقى «طلبٌ يحتاجُ إسنادًا
-- يدويًا» لطلبٍ انتهى.
--
-- **القرار:** جدولٌ صغيرٌ يحفظُ حالَ إغلاقِ كلِّ بطاقة، مفتاحُه أثرُ التصعيدِ نفسُه، فلا يُعدَّلُ
-- `audit_log` ولا تُنشأُ بطاقةٌ ثانية:
--   - `closed_at`: متى عُدِّلَت البطاقةُ نفسُها إلى مآلِها.
--   - `attempts`: محاولاتُ التعديلِ الفاشلة؛ والشوطُ يكفُّ بعدَ حدٍّ في الشيفرة.
--   - `outcome`: المآلُ المكتوب، للتدقيق.
-- والإغلاقُ عندَ الحالاتِ التي لا رجعةَ عنها فقط: `in_progress`/`completed` (أُسنِد)،
-- `cancelled`، `failed`. أمّا `matched` فلا: السائقُ قد ينسحبُ فيعودُ الطلبُ `searching`،
-- والتصعيدُ لا يُعادُ نشرُه (`ALREADY_ESCALATED`)، فبطاقةٌ مغلقةٌ حينَها تُخفي طلبًا يحتاجُ موظّفًا.
--
-- **البطاقاتُ الثلاثُ القائمة:** لا تُعلَّمُ مغلقةً هنا، فيعدّلُها الشوطُ في مرورِه الأوّل. وتعديلُ
-- الرسالةِ في Telegram لا يُطلقُ إشعارًا لأعضاءِ القروب، ولا يُنشئُ رسالة.
--
-- **العودة:** حذفُ الجدول. والشيفرةُ السابقةُ لا تقرؤه، والبطاقاتُ المعدَّلةُ تبقى نصًّا صادقًا.
-- =============================================================================

create table if not exists escalation_card_closures (
  audit_id   uuid primary key references audit_log(id) on delete cascade,
  order_id   uuid not null references orders(id) on delete cascade,
  city_id    uuid not null references cities(id),
  outcome    text check (outcome in ('assigned', 'cancelled', 'search_expired', 'ended')),
  attempts   integer not null default 0 check (attempts >= 0),
  closed_at  timestamptz,
  updated_at timestamptz not null default now()
);

alter table escalation_card_closures enable row level security;
revoke all on table escalation_card_closures from public, anon, authenticated;
grant select, insert, update on table escalation_card_closures to service_role;
