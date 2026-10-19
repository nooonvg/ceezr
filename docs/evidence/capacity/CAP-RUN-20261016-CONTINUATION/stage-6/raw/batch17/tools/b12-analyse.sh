#!/usr/bin/env bash
# تحليلُ جولةٍ في الدفعةِ 12: البوابات + كلفةُ السيناريو + الصلاحية + (إن وُجد) انتظارُ/احتجازُ المقاعد.
B=/srv/ceezr-cap-20261016; R=$1; E=$B/runs/$R/evidence
$B/bin/gates.sh $R > $E/gates.txt 2>&1; sed -n 2p $E/gates.txt | grep -oE "G1=[^|]*|P1=[^|]*|P2=[^|]*|P4=[^|]*|G4=[^|]*" | tr '\n' ' '; head -1 $E/gates.txt
python3 /home/user/workspace/wt-acc/deploy/capacity-run/monitor/scenario-cost.py $E > $E/scenario-cost.json 2>/dev/null
python3 - $E <<'PY'
import json,sys,os
E=sys.argv[1]; c=json.load(open(E+'/scenario-cost.json')); q=json.load(open(E+'/qual/inflight.json'))
print('scen',c['scenarios'],'per_s',c['scenarios_per_s'],'cpu/scen',c['cpu_ms_per_scenario_total_processes'],{k:v for k,v in c['cpu_ms_per_scenario'].items()})
print('host: steal',q['steal_mean'],'max10s',q['steal_10s_rolling_max'],'sib',q['siblings_mean'],'foreign',q['foreign_mean'],'iowait',q['iowait_mean'],'busy',q['host_busy_mean_pct'],'runq',q['procs_running_mean'],'post probes',q['post_speed_probe_median_ms'],q['post_pg_probe_median_ms'])
f=E+'/dispatch-trace.jsonl.load.jsonl'
if os.path.exists(f):
  agg={}
  for l in open(f):
    if '"k":"db"' in l:
      x=json.loads(l); a=agg.setdefault((x['pool'],x['kind']),[0,0,0]); a[0]+=x['n']; a[1]+=x['waitSumMs']; a[2]+=x['runSumMs']
  N=c['scenarios']
  for k,a in sorted(agg.items(),key=lambda x:-x[1][0]): print(' ',k,'per_scen',round(a[0]/N,1),'wait_mean',round(a[1]/a[0],1),'hold_mean',round(a[2]/a[0],2))
  print('  pg exec ms/scen',c.get('pg_exec_ms_per_scenario'),'pg stmts/scen',c.get('pg_statements_per_scenario'))
PY
