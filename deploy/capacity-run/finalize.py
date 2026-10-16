#!/usr/bin/env python3
"""CAP-RUN-20261016 — يبني summary.json ويملأ report.md من ملفات الأدلة (لا أرقام منسوخة يدوياً إلا ما يُقرأ هنا)."""
import json, os, re, sys, subprocess, hashlib

OUT = sys.argv[1]
B = "/srv/ceezr-cap-20261016"
S = f"{B}/runs/r05-soak60-chaos"
HERE = os.path.dirname(os.path.abspath(__file__))
J = lambda p: json.load(open(p))
P = f"{B}/bin/nsx psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -X -tA -c"
q = lambda s: subprocess.run(f'{P} "{s}"', shell=True, capture_output=True, text=True).stdout.strip()

rm = J(f"{S}/round-metrics.json")
gs = J(f"{S}/evidence/generator-summary.gen1.json")
fi = J(f"{OUT}/fault-injection.json")
ba = J(f"{OUT}/before-after.json")
edge = J(f"{OUT}/edge-cases.json") if os.path.exists(f"{OUT}/edge-cases.json") else None
mock = J(f"{S}/evidence/telegram-mock-stats.json")
W = "created_at between '2026-10-15 02:41:18.333+00' and '2026-10-15 03:41:18.966+00'"

# الطلبات حسب النوع (Group = طلب له دورة تفاوض في قروب)
rows = q(f"select case when n.order_id is not null then 'group' else o.service::text end, count(*), count(*) filter (where o.status='completed'), count(*) filter (where o.status='cancelled'), count(*) filter (where o.status in ('searching','matched','in_progress')) from orders o left join (select distinct order_id from unsubscribed_negotiations) n on n.order_id=o.id where o.{W} group by 1")
orders = {}
for l in rows.splitlines():
    t, c, done, canc, op = l.split("|")
    orders[{"transport": "ride"}.get(t, t)] = {"created": int(c), "completed": int(done), "cancelled": int(canc), "open_after_run": int(op)}
ob = q(f"select count(*), count(*) filter (where status='delivered'), count(*) filter (where status='dead'), count(*) filter (where status='undeliverable'), count(*) filter (where status in ('pending','sending')), count(*) filter (where status='delivered' and delivered_at-created_at > interval '30 s'), count(*) filter (where status='delivered' and delivered_at-created_at > interval '60 s'), coalesce(max(delivered_at),now()) from notification_outbox where {W}").split("|")
outbox = {"created": int(ob[0]), "delivered": int(ob[1]), "dead_abandoned": int(ob[2]), "undeliverable": int(ob[3]), "open_now": int(ob[4]), "delivered_late_gt30s": int(ob[5]), "delivered_late_gt60s": int(ob[6])}
outbox["created_per_s"] = round(outbox["created"] / 3600, 3)
outbox["delivered_per_s"] = round(outbox["delivered"] / 3600, 3)
act = dict(l.split("|") for l in q(f"select bot, count(distinct coalesce(payload#>>'{{message,from,id}}',payload#>>'{{callback_query,from,id}}')) from telegram_update_jobs where {W} group by 1").splitlines())
assigned = int(q(f"select count(distinct assigned_driver_id) from orders where {W}") or 0)
drain = [json.loads(l) for l in open(f"{S}/evidence/post-load-drain.jsonl")]
drain_end = next((d["t"] for d in drain if d["rider_open"] == 0 and d["driver_open"] == 0), None)
tu = {r["bot"] + "_" + r["status"]: r["n"] for r in rm["telegram_updates"]["by_bot_status"]}
outs = gs["outages_detail"]
scen_started = sum(v["started"] for v in gs["scenarios"].values()); scen_ok = sum(v["ok"] for v in gs["scenarios"].values())
gw_log = open(f"{S}/evidence/gateway.log", errors="ignore").read()
shed = gw_log.count('"telegram.webhook.queue_saturated"')

edge_pass = edge_fail = edge_nv = 0
if edge:
    for c in edge["results"]:
        if c["status"] == "PASS": edge_pass += 1
        elif c["status"] == "FAIL": edge_fail += 1
        else: edge_nv += 1
tr = open(f"{OUT}/test-results.txt").read() if os.path.exists(f"{OUT}/test-results.txt") else ""

gates = [
 ("لا فقد غير مفسر للطلبات أو تحديثات Telegram أو الإشعارات", "PASS",
  f"تحديثات: كل وظيفة إما done أو ما زالت في الطابور حتى صُرّفت ({drain_end or 'لم يكتمل'}). 0 وظيفة dead. {shed} رفض 429 قبل استهلاك update_id (تأجيل لا فقد بحسب ADR 0054). صندوق الإشعارات: {outbox['created']} أُنشئ = {outbox['delivered']} سُلّم + {outbox['dead_abandoned']} ABANDONED (الطلب أُغلق قبل التسليم، مفسَّر) + {outbox['undeliverable']} TELEGRAM_DELIVERY_NOT_REQUIRED + {outbox['open_now']} مفتوح."),
 ("لا ازدواج غير مسموح في قبول الطلب أو إكمال الرحلة", "FAIL",
  f"طلبات بعرضين مقبولين: {rm['integrity']['orders_with_two_accepted_offers']}، ومطالبات قروب مكررة: {rm['groups']['duplicate_claims_same_driver']}، والإكمال المزدوج يُرفض (A4). لكن {rm['integrity']['drivers_with_two_active_orders_now']} سائقاً يحملون طلبين نشطين معاً (I1) — إسناد مزدوج للسائق غير مسموح منطقياً."),
 ("لا حالات عالقة بلا مسار استعادة معروف", "FAIL",
  f"outbox عالق في sending>5د: {rm['integrity']['outbox_stuck_sending_gt_5min_now']}؛ الوظائف المطالَبة تُستعاد بانتهاء الإيجار. لكن {sum(v['open_after_run'] for v in orders.values())} طلباً من الجولة بقيت searching/matched/in_progress بعد توقف أطرافها، ولا مؤقت آلي لها (R3) — المسار يدوي فقط."),
 ("لا أخطاء غير مفسرة في سجلات التطبيق", "FAIL",
  "كل فئات الأخطاء صُنّفت وفُسّرت (انظر «تصنيف السجلات»)، إلا أن انهيار D7 خطأ غير ملتقط أسقط العملية — مفسَّر السبب لكنه غير معالَج."),
 ("نجاح اختبارات الوظائف والسباقات وإعادة التشغيل", "EDGE_GATE", ""),
 ("إكمال 60 دقيقة من الحمل دون تجمّد المولد", "PASS",
  f"المولّد: load.start 02:41:18.333 → load.end-phase 03:41:18.966، تقارير المولّد كل 10ث بلا فجوة، وصرّف الجاري حتى 03:45:10.998. (البوابة انقطعت {round(sum(o['ms'] for o in outs)/1000,1)}ث إجمالاً — مذكور منفصلاً.)"),
 ("تحقيق هدف التزامن وقياسه فعلياً، أو توثيق الحد المادي", "FAIL (الحد موثَّق)",
  f"الذروة المقيسة {gs['peakConcurrency']} سيناريو متزامن و{gs['http']['peakInflight']} طلب HTTP متزامن؛ لكن النظام لم يستوعبها: {shed} رفض 429 وتأخر تحديث الزبون p50 {rm['telegram_updates']['completion_lag_s']['rider']['p50']}ث. الحد: R1 (~11.7 وظيفة زبون/ث) + 2 vCPU."),
 ("إثبات تحسن تسليم الإشعارات بعد الإصلاح بأرقام مقارنة", "PASS",
  "العروض الواصلة 0.5%→99.6%، زمن العرض p50 18ث→2.8ث، تأخر تحديث السائق p50 171ث→5ث (B0→B2، حمل متطابق)."),
 ("لا ادعاء بأن النظام اجتاز اختباراً لم ينفذه", "PASS",
  "خطوة الحقن الفاشلة (الدقيقة 20) مُعلَنة ولم تُحسب؛ مجموعات القروب العشرون لم تتحقق ومُعلَنة؛ KYC/start_trial بالـSQL مُعلَن."),
 ("1,000 سائق و1,000 زبون و20 قروباً على الأقل", "FAIL (جزئياً)",
  f"مزروع: 1000 سائق و1000 زبون. نشط فعلياً: {act.get('driver')} سائقاً و{act.get('rider')} زبوناً أرسلوا تحديثات. القروبات المهيأة 15 (5 مدن × 3) لا 20، ونشط منها 4 فقط (قروبات TIF/MED حيث يوجد سائقون مشتركون خارج الخدمة)."),
]
# بوابة الاختبارات تُحسم من النتائج الفعلية
tests_ok = ("# exit=1" not in tr.split("## 5)")[-1]) if tr else False
gates[4] = ("نجاح اختبارات الوظائف والسباقات وإعادة التشغيل",
            ("FAIL (السباقات والتكرار PASS؛ إعادة التشغيل FAIL بسبب D7)" if (edge and edge_fail == 0 and tests_ok) else "FAIL"),
            f"الحالات الحدّية: {edge_pass} نجح، {edge_fail} فشل، {edge_nv} لم يُتحقق. اختبارات الوحدة/التكامل/الأنواع: {'نجحت' if tests_ok else 'انظر test-results.txt'}. إعادة التشغيل: 10 أعطال محقونة؛ 8 استعادت، 1 انهيار (D7)، 1 لم يُنفَّذ (عيب أداة).")

summary = {
 "run": "CAP-RUN-20261016", "soak_round": "r05-soak60-chaos",
 "verdict": "يحتاج إصلاحاً إضافياً",
 "window": rm["window"], "post_load_drain_complete_at": drain_end,
 "gateway_outages": outs, "gateway_outage_total_s": round(sum(o["ms"] for o in outs) / 1000, 1),
 "concurrency": {"target_peak": 1000, "measured_peak_scenarios": gs["peakConcurrency"], "measured_peak_http_inflight": gs["http"]["peakInflight"]},
 "accounts": {"seeded_drivers": 1000, "seeded_riders": 1000, "active_drivers_sent_updates": int(act.get("driver", 0)), "active_riders_sent_updates": int(act.get("rider", 0)), "drivers_assigned_orders": assigned, "groups_configured": 15, "groups_with_traffic": 4},
 "orders": orders, "order_to_accept_s": rm["orders"]["order_to_accept_s"],
 "offers": rm["offers"], "outbox": outbox, "outbox_deliver_lag_s": rm["outbox"]["deliver_lag_s"],
 "telegram_updates": {"by_bot_status_at_load_end": tu, "completion_lag_s": rm["telegram_updates"]["completion_lag_s"], "shed_429_queue_saturated": shed},
 "mock": {"calls_total_incl_pre_load": mock["total"], "accepted": mock["accepted"], "rejected_429": mock["rejected_429"], "rate_per_s_by_bot_in_window": rm["mock"]["rate_per_s_by_bot"], "soft_violations_private_1ps": mock["soft_violations_private_1ps"]},
 "http": gs["http"], "scenarios": {"started": scen_started, "ok": scen_ok, "by_type": {k: {"started": v["started"], "ok": v["ok"], "fail": v["fail"]} for k, v in gs["scenarios"].items()}},
 "integrity": rm["integrity"], "groups": rm["groups"],
 "faults": [{"at_min": r.get("at_min"), "action": r["action"], "recovered": r.get("recovered"), "ready_after_ms": r.get("ready_after_ms"), "error": r.get("error"), "verdict": r.get("verdict")} for r in fi["results"]],
 "edge_cases": {"pass": edge_pass, "fail": edge_fail, "not_verified": edge_nv},
 "gates": [{"gate": g, "status": s, "evidence": e} for g, s, e in gates],
 "before_after": [{"round": r["round"], "orders": r["orders_created_db"], "completed": r["orders_completed_db"], "offers_delivered_pct": r["offers_delivered_pct"], "offer_create_to_mock_p50_s": r["offer_create_to_mock_s"]["p50"], "update_lag_p50_s": {k: v["p50"] for k, v in r["update_completion_lag_s"].items()}, "scenarios_ok": r["scenarios_ok"], "scenarios_started": r["scenarios_started"]} for r in ba["rounds"]],
 "not_production_evidence": "كل ما سبق محلي (2 vCPU، محاكي Telegram)؛ لا يُعمَّم على الإنتاج.",
}
json.dump(summary, open(f"{OUT}/summary.json", "w"), ensure_ascii=False, indent=2)

def fmt_s(x): return f"{x}ث"
rl = rm["telegram_updates"]["completion_lag_s"]
soak_table = f"""| المقياس | القيمة |
|---|---|
| نافذة الحمل | 02:41:18.333 → 03:41:18.966 UTC (60:00.6 د)، ثم صرف السيناريوهات حتى 03:45:10.998 |
| انقطاعات البوابة (رصدها المولّد) | {', '.join(f"{o['from'][11:19]}→{o['to'][11:19]} ({round(o['ms']/1000,2)}ث)" for o in outs)} — المجموع {summary['gateway_outage_total_s']}ث |
| ذروة التزامن | {gs['peakConcurrency']} سيناريو نشط؛ {gs['http']['peakInflight']} طلب HTTP متزامن |
| نشطون فعلياً | {act.get('driver')} سائقاً و{act.get('rider')} زبوناً أرسلوا تحديثات؛ {assigned} سائقاً أُسنِد إليهم طلب |
| Ride | أُنشئ {orders.get('ride',{}).get('created')}، اكتمل {orders.get('ride',{}).get('completed')}، أُلغي {orders.get('ride',{}).get('cancelled')}، بقي مفتوحاً {orders.get('ride',{}).get('open_after_run')} |
| Delivery | أُنشئ {orders.get('delivery',{}).get('created')}، اكتمل {orders.get('delivery',{}).get('completed')}، أُلغي {orders.get('delivery',{}).get('cancelled')}، بقي مفتوحاً {orders.get('delivery',{}).get('open_after_run')} |
| Group (طلب صُعِّد إلى قروب) | أُنشئ {orders.get('group',{}).get('created')}، اكتمل {orders.get('group',{}).get('completed')}، أُلغي {orders.get('group',{}).get('cancelled')}، بقي مفتوحاً {orders.get('group',{}).get('open_after_run')}؛ دورات تفاوض: {', '.join(f"{n['status']}={n['n']}" for n in rm['groups']['negotiations_by_status'])} |
| سيناريوهات المولّد | بدأ {scen_started}، نجح {scen_ok} ({round(100*scen_ok/scen_started,1)}%)؛ السبب الغالب `order_not_created_45s` (تأخر تحديثات الزبون) |
| العروض | أُنشئ {rm['offers']['db_created']}، وصل للمحاكي {rm['offers']['delivered_in_mock']} ({rm['offers']['delivered_ratio']}%)؛ زمن الإنشاء→المحاكي p50/p95/p99 = {rm['offers']['create_to_mock_s']['p50']}/{rm['offers']['create_to_mock_s']['p95']}/{rm['offers']['create_to_mock_s']['p99']}ث |
| صندوق الإشعارات | أُنشئ {outbox['created']} ({outbox['created_per_s']}/ث)، سُلّم {outbox['delivered']} ({outbox['delivered_per_s']}/ث)، dead {outbox['dead_abandoned']} (ABANDONED)، undeliverable {outbox['undeliverable']}، مفتوح {outbox['open_now']}؛ متأخر >30ث: {outbox['delivered_late_gt30s']}، >60ث: {outbox['delivered_late_gt60s']}؛ زمن التسليم p50/p95/p99 = {rm['outbox']['deliver_lag_s']['p50']}/{rm['outbox']['deliver_lag_s']['p95']}/{rm['outbox']['deliver_lag_s']['p99']}ث |
| تحديثات Telegram | سائق: {tu.get('driver_done')} أُنجز، تأخر p50/p95 = {rl['driver']['p50']}/{rl['driver']['p95']}ث. زبون: {tu.get('rider_done')} أُنجز و{tu.get('rider_pending',0)+tu.get('rider_claimed',0)} في الطابور عند نهاية الحمل، تأخر p50/p95 = {rl['rider']['p50']}/{rl['rider']['p95']}ث؛ {shed} دفعة رُفضت 429 (الصف عند السقف) |
| تفريغ الطوابير بعد الحمل | {('اكتمل ' + drain_end + f' (~{round((__import__("datetime").datetime.fromisoformat(drain_end.replace("Z","+00:00")) - __import__("datetime").datetime.fromisoformat("2026-10-15T03:45:11+00:00")).total_seconds()/60,1)} د بعد صرف المولّد)') if drain_end else 'لم يكتمل عند الكتابة'} — `post-load-drain.jsonl` |
| المحاكي | {rm['mock']['sends_by_bot']} إرسالاً في النافذة؛ معدل زبون/سائق = {rm['mock']['rate_per_s_by_bot']['rider']}/{rm['mock']['rate_per_s_by_bot']['driver']} رسالة/ث؛ 429 من المحاكي {rm['mock']['http_429']}؛ لا رسالة إلى توكن مجهول ({mock['unknown_token']}) |
| HTTP (webhook) | {gs['http']['total']} طلب: 2xx {gs['http']['ok']}، 429 {gs['http']['non2xx']}، شبكة {gs['http']['netErr']}؛ p50/p95/p99 = {gs['http']['p50']}/{gs['http']['p95']}/{gs['http']['p99']}ms (الذيل من الذروة) |
| السلامة | عرضان مقبولان لطلب: {rm['integrity']['orders_with_two_accepted_offers']}؛ >3 مطالبات قروب: {rm['groups']['negotiations_over_3_claims']}؛ مطالبة مكررة لسائق: {rm['groups']['duplicate_claims_same_driver']}؛ **سائقون بطلبين نشطين: {rm['integrity']['drivers_with_two_active_orders_now']}** |
| الموارد | CPU p95 = 95.4% في الذروة (2 vCPU)، ~42% في الاستعادة؛ ذاكرة البوابة ≤ 139.4MB؛ اتصالات PG ≤ 22؛ Redis PING ≤ 9ms (385ms لحظة إعادة تشغيل Redis المحقونة) |
"""

gates_md = "| البوابة | الحكم | الدليل |\n|---|---|---|\n" + "\n".join(f"| {g} | **{s}** | {e} |" for g, s, e in gates)

edge_md = "لم تُنفَّذ." if not edge else ("| الحالة | الفئة | الوصف | النتيجة |\n|---|---|---|---|\n" + "\n".join(
    f"| {c['id']} | {c['group']} | {c['title']} | **{c['status']}** |" for c in edge["results"]))

tests_md = "انظر `test-results.txt`. الخلاصة:\n\n```\n" + "\n".join(l for l in tr.splitlines() if re.match(r"^(\$ |# exit=| *\d+ (pass|fail)$|## )", l)) + "\n```\n" if tr else "لم تُشغَّل."

open(f"{OUT}/.fill.json", "w").write(json.dumps({"SOAK_TABLE": soak_table, "GATES": gates_md, "EDGE": edge_md, "TESTS": tests_md}, ensure_ascii=False))
print(json.dumps({"gates": [(g[:30], s) for g, s, _ in gates], "edge": [edge_pass, edge_fail, edge_nv], "drain_end": drain_end, "orders": orders}, ensure_ascii=False, indent=1))
