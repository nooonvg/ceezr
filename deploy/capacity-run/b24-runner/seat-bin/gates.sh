#!/usr/bin/env bash
E=/srv/ceezr-cap-20261016/runs/$1/evidence; python3 - $E <<'PY'
import json,sys,collections
c=collections.Counter()
for l in open(sys.argv[1]+'/miniapp-load-events.jsonl'):
  try:e=json.loads(l)
  except: continue
  if e.get('event')=='scenario.outcome' and e.get('kind')!='verified': c[e.get('reason')]+=1
w=json.load(open(sys.argv[1]+'/wave-report.json'))
print('verdict',w['verdict'],w['failedGates'],'notverified',dict(c))
print(' | '.join(f"{g['id']}={g['value']}{'' if g['pass'] else '✗'}" for g in w['gates']+w['perf']))
PY
