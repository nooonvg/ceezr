import json,csv,statistics as st,sys,collections
E=sys.argv[1]
cr={(r[0],int(r[1])):(int(r[2]),int(r[3]) if r[3] else None,r[4],int(r[5])) for r in csv.reader(open(E+'/update-jobs.csv'))}
J=[];S=[];L=[]
for l in open(E+'/load-trace.jsonl'):
    d=json.loads(l)
    if d['k']=='job': J.append(d)
    elif d['k']=='sweep': S.append(d)
    elif d['k']=='loop': L.append(d)
def q(a,p): a=sorted(a); return round(a[min(len(a)-1,int(p*len(a)))],1) if a else None
out={}
def show(n,a): out[n]=dict(n=len(a),p50=q(a,.5),p95=q(a,.95),p99=q(a,.99),mean=round(st.mean(a),1) if a else None)
show('queue_wait_ms',[j['claimedAt']-cr[(j['bot'],j['updateId'])][0] for j in J])
show('lane_wait_ms',[j['startedAt']-j['claimedAt'] for j in J])
show('run_ms',[j['endedAt']-j['startedAt'] for j in J])
tot=[j['endedAt']-cr[(j['bot'],j['updateId'])][0] for j in J]; show('create_to_end_ms',tot)
for k in ('effectCheckMs','prepareMs','recordMs'): show(k,[j[k] for j in J if j[k] is not None])
show('sweep_claim_ms',[s['claimMs'] for s in S]); show('sweep_claim_trips',[s['claimTrips'] for s in S]); show('sweep_dur_ms',[s['endedAt']-s['startedAt'] for s in S])
show('loop_lag_p95_ms',[x['lagP95Ms'] for x in L if x['lagP95Ms'] is not None]); show('process_cpu_pct',[x['processCpuPct'] for x in L])
# occupancy: integrate running jobs over the active window
ev=[]
for j in J: ev+= [(j['startedAt'],1),(j['endedAt'],-1)]
ev.sort(); a=0;area=0;last=ev[0][0]
for t,dl in ev: area+=a*(t-last); last=t; a+=dl
span=ev[-1][0]-ev[0][0]
out['mean_running_jobs']=round(area/span,2); out['jobs']=len(J); out['span_s']=round(span/1000,1)
out['over_20s']=sum(t>20000 for t in tot); out['attempts_gt1']=sum(v[3]>1 for v in cr.values()); out['not_done']=sum(v[2]!='done' for v in cr.values())
out['sweeps']=len(S); out['truncated']=sum(s['truncated'] for s in S)
# throughput per 10s: created vs completed
c=collections.Counter(); d=collections.Counter()
t0=min(v[0] for v in cr.values())
for v in cr.values():
    c[(v[0]-t0)//10000]+=1
    if v[1]: d[(v[1]-t0)//10000]+=1
out['per10s_created']=[c[i] for i in range(max(c)+1)]; out['per10s_completed']=[d[i] for i in range(max(d)+1)]
json.dump(out,open(E+'/b20-drainer-analysis.json','w'),ensure_ascii=False,indent=1)
for k,v in out.items(): print(k,v)
