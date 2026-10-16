-- CAP-RUN-20261016: تفعيل المدن الخمس في القاعدة التجريبية بمعرّفات قروبات وهمية (سالبة، نطاق -100000000000xx).
update cities c set is_active = true,
  telegram_support_group_id = -(1000000000000 + x.idx*10 + 1),
  telegram_escalation_group_id = -(1000000000000 + x.idx*10 + 2),
  telegram_unsubscribed_drivers_group_id = -(1000000000000 + x.idx*10 + 3)
from (values ('JED',1),('MKK',2),('RUH',3),('TIF',4),('MED',5)) x(code, idx) where c.code = x.code;
-- مدينتا القروب: تصعيد أسرع للقروب (30ث بدل 180ث) — تعديل إعداد تجريبي معلن، لا تعديل كود.
update platform_settings ps set value = '30'::jsonb from cities c
 where ps.city_id = c.id and c.code in ('TIF','MED') and ps.key = 'unmatched_escalate_after_seconds';
select code, is_active from cities order by code;
