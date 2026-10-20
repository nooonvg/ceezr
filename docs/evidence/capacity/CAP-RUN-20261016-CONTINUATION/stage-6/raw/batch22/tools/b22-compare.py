import json,sys,os,collections,csv,re,statistics as st
sys.path.insert(0,'/srv/ceezr-cap-20261016/bin')
import importlib.util
spec=importlib.util.spec_from_file_location('b21','/srv/ceezr-cap-20261016/bin/b21-compare.py')
B='/srv/ceezr-cap-20261016'
def pct(xs,p):
    xs=sorted(xs); return xs[min(len(xs)-1,int(p*len(xs)))] if xs else None
def load(r):
    src=open(B+'/bin/b21-compare.py').read().split('for r in sys.argv')[0]
    ns={}; exec(src,ns); out=ns['load'](r)
    E=f'{B}/runs/{r}/evidence'; Q=f'{B}/qual/{r}'
    out['env']=open(f'{E}/b22-env.txt').read().strip() if os.path.exists(f'{E}/b22-env.txt') else None
    tl=[json.loads(l) for l in open(f'{E}/timeline.jsonl')] if os.path.exists(f'{E}/timeline.jsonl') else []
    out['code_sha']=next((d.get('code_sha') for d in tl if d.get('code_sha')),None)
    # trace: wait vs run per query, loop lag, cpu
    T=f'{E}/load-trace.jsonl'; lag=[];cpu=[]; n=w=rn=0
    for l in open(T):
        d=json.loads(l)
        if d['k']=='loop' and d['processCpuPct']>20: lag.append(d['lagP95Ms']); cpu.append(d['processCpuPct'])
        if d['k']=='db' and d['pool'].endswith('Request') and d['kind']=='query': n+=d['n']; w+=d['waitSumMs']; rn+=d['runSumMs']
    out['q_wait_ms']=round(w/max(n,1),1); out['q_run_ms']=round(rn/max(n,1),2)
    out['loop_lag_p95_median_ms']=round(st.median(lag),1) if lag else None; out['loop_lag_p95_max_ms']=round(max(lag),1) if lag else None
    out['gw_proc_cpu_median']=st.median(cpu) if cpu else None
    # conn samples
    C=f'{E}/conn-samples.csv'; byt=collections.defaultdict(lambda:collections.Counter())
    if os.path.exists(C):
        for row in csv.reader(open(C)):
            if len(row)!=4 or not row[0].isdigit(): continue
            if row[1]=='ceezr:gatewayRequest': byt[int(row[0])][row[2]]+=int(row[3])
        tot=[sum(c.values()) for c in byt.values()]; act=[c['active'] for c in byt.values()]
        out['gwreq_conn_max']=max(tot) if tot else None; out['gwreq_active_p50']=pct(act,.5); out['gwreq_active_p95']=pct(act,.95); out['gwreq_active_max']=max(act) if act else None
    # host
    hs=[json.loads(l) for l in open(f'{Q}/wave-host.jsonl') if '"k": "host"' in l]
    idle=[h['cpu']['idle'] for h in hs]; out['host_idle_median']=st.median(idle) if idle else None
    # resources: pg/gateway cpu
    R=f'{E}/resources.jsonl'
    if os.path.exists(R):
        rs=[json.loads(l) for l in open(R)]
        act=[x for x in rs if x['gateway']['cpu_pct']>20]
        out['pg_cpu_median']=st.median(x['postgres']['cpu_pct'] for x in act) if act else None
        out['gw_cpu_median']=st.median(x['gateway']['cpu_pct'] for x in act) if act else None
    # telegram throughput & oldest pending
    U=f'{E}/update-jobs.csv'; rows=[r_ for r_ in csv.reader(open(U))]
    done=[int(x[3]) for x in rows if x[3]]
    if done:
        t0=min(int(x[2]) for x in rows); span=(max(done)-t0)/1000
        out['tg_jobs']=len(rows); out['tg_done']=len(done); out['tg_per_s']=round(len(done)/span,1)
        lat=[(int(x[3])-int(x[2]))/1000 for x in rows if x[3]]; out['tg_lat_p50_s']=round(pct(lat,.5),2); out['tg_lat_p95_s']=round(pct(lat,.95),2)
        out['tg_not_done']=sum(1 for x in rows if not x[3])
    a=json.load(open(f'{E}/db-audit-post.json')) if os.path.exists(f'{E}/db-audit-post.json') else {}
    out['audit_post']={k:v for k,v in a.items() if any(s in k for s in ('pending','oldest','stale','leftover','violation'))} if isinstance(a,dict) else None
    # gateway log errors
    G=f'{E}/gateway.wave.log'; ev=collections.Counter()
    if os.path.exists(G):
        for l in open(G,errors='ignore'):
            if re.search(r'redis|ECONN|connection|pool|deadline|CONNECT_TIMEOUT|too many', l, re.I) and re.search(r'error|fail|timeout|exceed|reject',l,re.I):
                m=re.search(r'"event":"([^"]+)"',l); ev[m.group(1) if m else l[:60]]+=1
    out['conn_redis_errors']=dict(ev.most_common(8))
    p=f'{E}/wave-report.json'
    if os.path.exists(p):
        w_=json.load(open(p)); out['gates_all']={g['id']:g.get('value') for g in w_['gates']}; out['perf_all']={x['id']:x['value'] for x in w_['perf']}
    return out
rows=[load(r) for r in sys.argv[1:]]
print(json.dumps(rows,ensure_ascii=False,indent=1))
