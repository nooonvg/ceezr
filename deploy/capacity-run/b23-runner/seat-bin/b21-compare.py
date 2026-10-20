import json,sys,os,collections,csv
B='/srv/ceezr-cap-20261016'
def load(r):
    E=f'{B}/runs/{r}/evidence'; Q=f'{B}/qual/{r}'
    out={'round':r}
    for ph in ('preflight','inflight'):
        p=f'{Q}/{ph}.json'
        out[ph]=json.load(open(p)).get('verdict') if os.path.exists(p) else 'MISSING'
        if os.path.exists(p) and out[ph]!='VALID': out[ph+'_why']=json.load(open(p)).get('violations')
    hp=f'{Q}/wave-host.jsonl'
    if os.path.exists(hp):
        ts=[json.loads(l)['t'] for l in open(hp) if '"k": "host"' in l]
        out['host_gap_max_s']=round(max([(b-a)/1000 for a,b in zip(ts,ts[1:])] or [0]),1)
        if out['host_gap_max_s']>5: out['host_gap_verdict']='INVALID_ENV'
    p=f'{E}/wave-report.json'
    if not os.path.exists(p): return out
    w=json.load(open(p))
    out['failed']=w['failedGates']
    g={x['id']:x.get('value') for x in w['gates']}; pf={x['id']:x['value'] for x in w['perf']}
    out['G1']=g.get('G1'); out['G4']=g.get('G4'); out['G5']=g.get('G5')
    for k in ('P1','P2','P3','P4','P5','P7'): out[k]=pf.get(k)
    done=int(g['G1'].split('(')[1].split('/')[0]); tot=int(g['G1'].split('/')[1].rstrip(')'))
    out['completed']=done; out['scenarios']=tot
    T=f'{E}/load-trace.jsonl'
    if os.path.exists(T):
        q=0;hold=0;wait=0;n=0;rq=collections.Counter()
        for l in open(T):
            d=json.loads(l)
            if d['k']=='db' and d['pool'].endswith('Request') and d['kind']=='query':
                n+=d['n']; hold+=d['runSumMs']; wait+=d['waitSumMs']
            if d['k']=='rsig' and d['pool'].endswith('Request') and d['kind']!='txQuery': rq[d['route']]+=d['n']
        out['req_queries']=n; out['req_q_per_completed']=round(n/max(done,1),1); out['req_q_per_scenario']=round(n/tot,1)
        out['req_hold_s']=round(hold/1000,1); out['req_wait_mean_ms']=round(wait/max(n,1),1)
        out['phase_routes_q']={k:v for k,v in rq.items() if '/v1/driver/job/' in k}
    U=f'{E}/update-jobs.csv'
    if os.path.exists(U):
        rows=[r for r in csv.reader(open(U))]
        out['tg_over20']=sum(1 for r in rows if r[3] and int(r[3])-int(r[2])>20000)
    p=f'{E}/pgss-full.csv'
    if os.path.exists(p):
        rows=list(csv.DictReader(open(p))); out['pg_exec_s']=round(sum(float(x['total_ms']) for x in rows)/1000,1); out['pg_calls']=sum(int(x['calls']) for x in rows)
    return out
for r in sys.argv[1:]:
    print(json.dumps(load(r),ensure_ascii=False))
