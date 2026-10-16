-- migration-phase: index
--
-- فهرسُ مسارِ وظائفِ تيليجرام المفتوحِ (من `20261015000200`): وظيفةٌ معلّقةٌ أو
-- محجوزةٌ واحدةٌ على الأكثر لكلِّ مفتاحِ مسارٍ — يقرأُهُ `claim_telegram_update_job`
-- في ترتيبِهِ. `concurrently` لأنَّ جدولَ الوظائفِ حارٌّ — فالقفلُ الحاجزُ للكتابةِ
-- توقُّفُ خدمةٍ (CAP-007) — ولهذا هو في ملفٍّ وحدَهُ بلا معاملةٍ.

create index concurrently if not exists telegram_update_jobs_lane_open_idx
  on telegram_update_jobs (lane_key, created_at, update_id)
  where status in ('pending', 'claimed');
