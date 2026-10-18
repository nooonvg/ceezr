#!/usr/bin/env bash
E=/home/user/cap-seat/runs/$1/evidence; python3 /home/user/workspace/ceezr/deploy/capacity-run/monitor/p4-decompose.py $E | python3 -c "
import sys,json;t=sys.stdin.read();i=t.index('backlog:');d=json.loads(t[:i]);
for k in ['scenarios','P4','queue_before_first_exec_ms','first_exec_ms','order_created_to_target_offer_ms','target_offer_to_board_seen_ms','target_offer_round','exec_count_per_order','final_broadcast_round','rates']: print(k, json.dumps(d[k],ensure_ascii=False))
p=d['passes'];print('passes', json.dumps({k:p[k] if not isinstance(p[k],dict) else p[k].get('p50') for k in p}))
print('phase p50/p95', json.dumps({k:(v.get('p50'),v.get('p95'),v.get('mean')) for k,v in d['phase_ms_per_order_exec'].items()}))
print('probes p50/p95',json.dumps({k:(d['probes'][k]['p50'],d['probes'][k]['p95']) for k in d['probes']}));print(t[i:i+300])"
python3 -c "import json;r=json.load(open('$E/wave-report.json'));print('verdict',r['verdict'],r['failedGates'],'total',r['total'],'verified',r['verified'])"
