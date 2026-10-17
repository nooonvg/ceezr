-- migration-phase: expand
-- =============================================================================
-- `LOAD-01 Recovery` (CAP-RUN-20261016-CONTINUATION · المرحلة 6-استكمال — الجدار
-- الثاني: الإشعاراتُ) — إيصالاتُ لوحِ العروضِ: إثباتُ وصولِ العرضِ إلى سائقٍ
-- عبرَ لوحِ Mini App، من الجهةِ التي يملكُ الحكمَ (الخادمُ) لا من ادعاءِ
-- الإرسالِ.
--
-- **لِمَ إيصالٌ لا «آخرُ قراءةٍ»:** طابعُ «قرأ اللوحَ في T» لا يُثبِتُ وصولَ
-- عرضٍ بعينِهِ — قد يُنشأ العرضُ بعدَ الاستعلامِ، أو تُستبعدَه الترشيحاتُ من
-- الردِّ. الإيصالُ مرتبطٌ **بمعرّفاتِ العروضِ التي أعادها الخادمُ فعلًا**
-- للسائقِ المستخرَجِ من جلستِهِ الموقعةِ، فيصيرُ «استلامَ العميلِ» حقيقةً
-- مقيسةً لا دلالةً عليها.
--
-- **ولِمَ من العميلِ لا من الجلبِ:** استجابةُ HTTP على جلبِ اللوحِ تُثبِتُ
-- أنَّ الخادمَ سلّمها، لا أنَّ العميلَ طبّقها؛ فالإيصالُ يُرسِلُه العميلُ بعدَ
-- تطبيقِ اللقطةِ (مسارُ /receipts أدناه)، فيفصلُ «أُرسِلَ» عنِ «وَصَلَ».
--
-- المفتاحُ `driver_id` هوَ معرّفُ السائقِ الداخليُّ (drivers.id) — نفسُهُ الذي
-- تحملُه حمولةُ صفِّ العرضِ في الصادرِ (`payload->>'driver_id'`)، فيجدُه
-- شوطُ التسليمِ بلا انضمامٍ ولا تحويلٍ. والواجهةُ تحلُّ جلستَها إلى هذا
-- المعرفِ عبرَ users/drivers قبلَ الكتابةِ.
-- =============================================================================

create table if not exists public.driver_offers_board_receipts (
  driver_id uuid not null,
  offer_id uuid not null,
  -- القاعدةُ 0.4: كلُّ جدولٍ يحملُ مدينتَهُ — الإيصالُ يُستَخلَصُ من مدينةِ
  -- السائقِ نفسِهِ (drivers.city_id) وقتَ التسجيلِ، فيصيرُ التقريرُ المدينيُّ
  -- صادقًا بلا انضمامٍ.
  city_id uuid not null,
  received_at timestamptz not null default now(),
  primary key (driver_id, offer_id),
  foreign key (city_id) references cities (id)
);

-- سجلُّ الخدمةِ وحدَهُ يكتبُ ويقرأُ: الإيصالُ عقدٌ بينَ عميلٍ موثَّقٍ وخدمةِ
-- التسليمِ، لا بياناتٍ عامةَ القراءةِ. و`SEC-10`: كلُّ جدولٍ لنا عليهِ RLS
-- ولا جدولَ واحدٌ عليهِ force — سياسةُ service_role الواسعةُ كما في أخواتِهِ
-- (البوّابةُ تقرأُ وتكتبُ بسرِّ الخدمةِ لا بجلسةِ عميلٍ).
alter table public.driver_offers_board_receipts enable row level security;
drop policy if exists driver_offers_board_receipts_service_role on public.driver_offers_board_receipts;
create policy driver_offers_board_receipts_service_role on public.driver_offers_board_receipts
  for all to service_role using (true) with check (true);
grant select, insert, delete on public.driver_offers_board_receipts to service_role;
revoke all on public.driver_offers_board_receipts from public, anon, authenticated;

-- التراجعُ المعلَنُ: إسقاطُ الجدولِ لا يمسُّ أيَّ بياناتِ إنتاجٍ قائمةٍ (جدولٌ
-- جديدٌ في طورِ التوسعةِ) ولا يقفلُ رجوعًا أحدًا؛ سجلُّ التراجعِ يوثِّقُه.
