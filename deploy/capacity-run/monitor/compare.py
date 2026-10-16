#!/usr/bin/env python3
"""CAP-RUN-20261016 — مقارنة جولات متماثلة الحمل من round-metrics.json → before-after.json"""
import json, sys
B = "/srv/ceezr-cap-20261016/runs"
def row(r):
    d = json.load(open(f"{B}/{r}/round-metrics.json"))
    g = d["generator"] or {}
    sc = g.get("scenarios", {})
    st = sum(v["started"] for v in sc.values()); ok = sum(v["ok"] for v in sc.values())
    reasons = {}
    for v in sc.values():
        for k, n in v["reasons"].items(): reasons[k] = reasons.get(k, 0) + n
    bs = {x["status"]: 0 for x in d["orders"]["by_service_status"]}
    for x in d["orders"]["by_service_status"]: bs[x["status"]] += x["n"]
    return {
        "round": r, "code": [s.get("sha") for s in d["gateway_starts"]][-1:] , "code_dir": [s.get("code_dir") for s in d["gateway_starts"]][-1:],
        "window": d["window"],
        "orders_created_db": d["orders"]["total"], "orders_by_status_db": bs,
        "orders_completed_db": bs.get("completed", 0),
        "order_to_accept_s_db": d["orders"]["order_to_accept_s"],
        "offers_created_db": d["offers"]["db_created"], "offers_delivered_mock": d["offers"]["delivered_in_mock"],
        "offers_delivered_pct": d["offers"]["delivered_ratio"], "offer_create_to_mock_s": d["offers"]["create_to_mock_s"],
        "outbox_deliver_lag_s": d["outbox"]["deliver_lag_s"],
        "update_completion_lag_s": d["telegram_updates"]["completion_lag_s"],
        "mock_msgs_per_s": d["mock"]["rate_per_s_by_bot"], "mock_429": d["mock"]["http_429"],
        "scenarios_started": st, "scenarios_ok": ok, "scenario_fail_reasons": reasons,
        "http": {k: g.get("http", {}).get(k) for k in ("total", "ok", "non2xx", "netErr", "timeouts", "p50", "p95", "p99")},
        "integrity": d["integrity"], "groups": d["groups"],
    }
rounds = sys.argv[1:]
out = {"profile": "warm 60s@50 ثم steady 480s@150 (متطابق في كل الجولات)", "rounds": [row(r) for r in rounds]}
json.dump(out, open(f"{B}/before-after.json", "w"), ensure_ascii=False, indent=2)
for x in out["rounds"]:
    print(x["round"], "orders", x["orders_created_db"], "completed", x["orders_completed_db"], "offers", x["offers_created_db"], "deliv%", x["offers_delivered_pct"],
          "offer_lag_p50", x["offer_create_to_mock_s"]["p50"], "upd_lag_p50", {b: v["p50"] for b, v in x["update_completion_lag_s"].items()}, "scen", x["scenarios_ok"], "/", x["scenarios_started"], "msg/s", x["mock_msgs_per_s"], "http_p95", x["http"]["p95"])
