-- بذرُ مقعدِ السعةِ فوقَ قاعدةٍ مُهاجَرةٍ نظيفةٍ (قالبُ ceezr_cap_tpl) — يُطبَّقُ مرةً
-- على القالبِ، ومنه تُنسخُ قاعدةُ الموجاتِ قبلَ كلِّ جولةٍ (bin/fresh-db.sh).
-- مطابقٌ حرفيًا لما طُبِّقَ في الدفعةِ السادسةِ (r1–r9): تفعيلُ المدنِ الخمسِ
-- بمعرّفاتِ مجموعاتٍ تجريبيةٍ سالبةٍ (لا تيليجرامَ حقيقيٌّ)، وتصعيدٌ أسرعُ في
-- مدينتَي القروبِ — إعدادٌ تجريبيٌّ معلنٌ لا تعديلُ كودٍ.
update cities c set is_active = true,
  telegram_support_group_id = -(1000000000000 + x.idx*10 + 1),
  telegram_escalation_group_id = -(1000000000000 + x.idx*10 + 2),
  telegram_unsubscribed_drivers_group_id = -(1000000000000 + x.idx*10 + 3)
from (values ('JED',1),('MKK',2),('RUH',3),('TIF',4),('MED',5)) x(code, idx) where c.code = x.code;
update platform_settings ps set value = '30'::jsonb from cities c
 where ps.city_id = c.id and c.code in ('TIF','MED') and ps.key = 'unmatched_escalate_after_seconds';
