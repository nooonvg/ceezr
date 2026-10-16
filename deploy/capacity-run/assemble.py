#!/usr/bin/env python3
"""يجمع report.md من القالب + answers.md + الجداول المحسوبة (.fill.json) + summary.json."""
import json, sys
OUT = sys.argv[1]
f = json.load(open(OUT + '/.fill.json')); sm = json.load(open(OUT + '/summary.json'))
o = sm['orders']; ob = sm['outbox']; of = sm['offers']; mk = sm['mock']; rate = mk['rate_per_s_by_bot_in_window']
q6 = "| النوع | أُنشئ | اكتمل | أُلغي | بقي مفتوحاً |\n|---|---|---|---|---|\n" + "\n".join(
    f"| {n} | {o[k]['created']} | {o[k]['completed']} | {o[k]['cancelled']} | {o[k]['open_after_run']} |" for n, k in [('Ride', 'ride'), ('Delivery', 'delivery'), ('Group (صُعِّد إلى قروب)', 'group')])
q6 += f"\n| **المجموع** | {sum(v['created'] for v in o.values())} | {sum(v['completed'] for v in o.values())} | {sum(v['cancelled'] for v in o.values())} | {sum(v['open_after_run'] for v in o.values())} |"
q7 = f"""**عروض السائقين:**
- أُنشئ **{of['db_created']}** عرضاً، ووصل إلى المحاكي **{of['delivered_in_mock']}** ({of['delivered_ratio']}%).
- زمن الوصول p50/p95/p99 = {of['create_to_mock_s']['p50']}/{of['create_to_mock_s']['p95']}/{of['create_to_mock_s']['p99']}ث.

**صندوق الإشعارات (كل الأنواع):**
- أُنشئ **{ob['created']}**، وسُلّم **{ob['delivered']}**.
- لم يُسلَّم: {ob['dead_abandoned']} (`ABANDONED`: الطلب أُغلق قبل التسليم، وهذا مقصود) و{ob['undeliverable']} (`TELEGRAM_DELIVERY_NOT_REQUIRED`).
- مفتوح: {ob['open_now']}.
- تأخر: {ob['delivered_late_gt30s']} سُلّم بعد أكثر من 30ث، و{ob['delivered_late_gt60s']} بعد أكثر من 60ث.
- زمن التسليم p50/p95/p99 = {sm['outbox_deliver_lag_s']['p50']}/{sm['outbox_deliver_lag_s']['p95']}/{sm['outbox_deliver_lag_s']['p99']}ث.

**ردود الحوار:** لا تمر بالصندوق، وتُرسل من معالج التحديث. سجّل المحاكي في النافذة {rate['rider']} رسالة/ث للزبون و{rate['driver']} للسائق. رُفض منها بـ429 (حد المحادثة) 4,169 داخل النافذة و{mk['rejected_429']} منذ بدء المحاكي، وأُعيدت."""
q8 = f"""**صندوق الإشعارات:** الإنشاء **{ob['created_per_s']}/ث** مقابل التسليم **{ob['delivered_per_s']}/ث**. التسليم يلاحق الإنشاء، ولم يتراكم شيء في نهاية الجولة.

**المسار الذي فيه الفرق الحقيقي (تحديثات الزبون):**
- الوصول ~12/ث عند تزامن 150، وأكثر بكثير في الذروة.
- الإنجاز ~11.7/ث.
- النتيجة: صف عند سقفه (~15,000) طوال ما بعد الذروة، و{sm['telegram_updates']['shed_429_queue_saturated']} رفض 429.
- التفريغ اكتمل {sm['post_load_drain_complete_at']}، أي بعد ~23 دقيقة من توقف المولّد، و0 وظيفة dead (`post-load-drain.jsonl`)."""
ans = open('answers.md').read().replace('{{Q6}}', q6).replace('{{Q7}}', q7).replace('{{Q8}}', q8)
t = open('report.template.md').read()
for k in ['SOAK_TABLE', 'GATES', 'EDGE', 'TESTS']:
    t = t.replace('{{' + k + '}}', f[k])
t = t.replace('{{ANSWERS}}', ans)
import re
t = re.sub(r'PATH=\S+ ', 'PATH=$PATH ', t).replace('/srv/ceezr-cap-20261016/bin/nsx', '$B/bin/nsx')
assert '{{' not in t
open(OUT + '/report.md', 'w').write(t)
print(len(t))
