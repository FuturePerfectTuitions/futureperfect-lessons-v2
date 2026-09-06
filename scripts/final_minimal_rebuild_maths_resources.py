#!/usr/bin/env python3
import copy,json,os,re,urllib.parse,requests
from pathlib import PurePosixPath

YEARS={4:('MATHS_L1',1,100),5:('MATHS_L2',2,137),6:('MATHS_L3',3,138)}
api='https://api.cloudflare.com/client/v4'
acct=os.environ['CLOUDFLARE_ACCOUNT_ID']; token=os.environ['CLOUDFLARE_API_TOKEN']; auth={'Authorization':f'Bearer {token}'}
settings=requests.get(f'{api}/accounts/{acct}/workers/scripts/fpt-portal-v2-worker/settings',headers=auth,timeout=60).json(); assert settings.get('success')
binds=settings['result']['bindings']; env=next(x.get('text') for x in binds if x.get('name')=='ENVIRONMENT'); bucket=next(x.get('bucket_name') for x in binds if x.get('name')=='MATERIALS_R2'); ns=next(x.get('namespace_id') for x in binds if x.get('name')=='LESSONS_KV')
assert env=='development'; assert bucket=='fpt-materials-dev'; assert ns
kvbase=f'{api}/accounts/{acct}/storage/kv/namespaces/{ns}/values/'
def kvurl(k): return kvbase+urllib.parse.quote(k,safe='')
def kvget(k):
    q=requests.get(kvurl(k),headers=auth,timeout=60); q.raise_for_status(); return q.json()
def kvput(k,v):
    q=requests.put(kvurl(k),headers={**auth,'Content-Type':'application/json'},data=json.dumps(v,separators=(',',':')).encode(),timeout=60); q.raise_for_status(); p=q.json(); assert p.get('success'),p
objs=[]; cursor=None
while True:
    params={'per_page':'1000'}
    if cursor: params['cursor']=cursor
    p=requests.get(f'{api}/accounts/{acct}/r2/buckets/{bucket}/objects',headers=auth,params=params,timeout=120).json(); assert p.get('success'),p
    objs.extend(p.get('result') or []); info=p.get('result_info') or {}; cursor=info.get('cursor') if info.get('is_truncated') else None
    if not cursor: break
r2keys={o.get('key') for o in objs if o.get('key') and not o.get('key').endswith('/')}

def fname(k): return k.rsplit('/',1)[-1]
def fileobj(k): return {'displayName':fname(k),'r2Key':k}
def sig(k,year):
    s=PurePosixPath(fname(k)).stem.lower().replace('11+',' ')
    s=re.sub(r'\banswer\s*pack\b|\banswer\s*key\b|\banswers?\b',' ',s)
    s=re.sub(fr'\b(?:l[123]t[123]m\d{{2}}|y{year}t[123]m\d{{2}}|y{year}m[0-9.]+)\b',' ',s)
    s=re.sub(r'\b(?:homework|prelesson|pre\s*lesson|sheets?|sheet|set)\b',' ',s)
    s=re.sub(r'[^a-z0-9]+',' ',s).strip()
    return s
def pair_group(sheets,answers,primary_name,year):
    answers=list(sorted(answers)); used=set(); pairs=[]; bysig={}
    for a in answers: bysig.setdefault(sig(a,year),[]).append(a)
    for s in sorted(sheets):
        hits=[a for a in bysig.get(sig(s,year),[]) if a not in used]
        a=hits[0] if len(hits)==1 else None
        if a: used.add(a)
        pairs.append({primary_name:fileobj(s),'answerPack':fileobj(a) if a else None})
    leftovers=[fileobj(a) for a in answers if a not in used]
    return pairs,leftovers
def is11(k): return '/11plus/' in k.lower() or '11+' in fname(k).lower()
def iscum(k): return '/cumulative-homework/' in k.lower() or 'cumulative homework' in fname(k).lower()
def refs_in(x,out=None):
    if out is None: out=[]
    if isinstance(x,dict):
        for k,v in x.items():
            if k=='r2Key' and isinstance(v,str) and v.strip(): out.append(v.strip())
            else: refs_in(v,out)
    elif isinstance(x,list):
        for v in x: refs_in(v,out)
    return out

plans={}; reports={}
for year,(curriculum,level,expected_objects) in YEARS.items():
    prefix=f'maths/year{year}/L{level}T'
    current=sorted(k for k in r2keys if k.startswith(prefix))
    assert len(current)==expected_objects,(year,len(current),expected_objects)
    current_set=set(current)
    cur=kvget('curriculum:'+curriculum); lesson_ids=cur.get('lessonIds') or []
    expected_lessons={4:35,5:38,6:43}[year]; assert len(lesson_ids)==expected_lessons
    code_rx=re.compile(fr'^L{level}T[123]M\d{{2}}$')
    year_plans={}; accounted=set(); per={}
    for lid in lesson_ids:
        rec=kvget('lesson:'+lid); assert rec.get('active') is not False
        code=str((rec.get('displayIds') or {}).get(f'maths-level{level}') or '').strip(); assert code_rx.fullmatch(code),(lid,code)
        ks=sorted(k for k in current if k.startswith(f'maths/year{year}/{code}/'))
        normal_hw_s=[k for k in ks if '/homework/sheets/' in k and not is11(k) and not iscum(k)]
        normal_hw_a=[k for k in ks if '/homework/answers/' in k and not is11(k) and not iscum(k)]
        normal_cum_s=[k for k in ks if (('/homework/sheets/' in k) or '/cumulative-homework/sheets/' in k) and not is11(k) and iscum(k)]
        normal_cum_a=[k for k in ks if (('/homework/answers/' in k) or '/cumulative-homework/answers/' in k) and not is11(k) and iscum(k)]
        normal_pre_s=[k for k in ks if '/prelesson/sheets/' in k and not is11(k)]
        normal_pre_a=[k for k in ks if '/prelesson/answers/' in k and not is11(k)]
        normal_other=[k for k in ks if '/other/' in k and not is11(k)]
        ep_hw_s=[k for k in ks if '/homework/sheets/' in k and is11(k) and not iscum(k)]
        ep_hw_a=[k for k in ks if '/homework/answers/' in k and is11(k) and not iscum(k)]
        ep_cum_s=[k for k in ks if (('/homework/sheets/' in k) or '/cumulative-homework/sheets/' in k) and is11(k) and iscum(k)]
        ep_cum_a=[k for k in ks if (('/homework/answers/' in k) or '/cumulative-homework/answers/' in k) and is11(k) and iscum(k)]
        ep_pre_s=[k for k in ks if '/prelesson/sheets/' in k and is11(k)]
        ep_pre_a=[k for k in ks if '/prelesson/answers/' in k and is11(k)]
        ep_other=[k for k in ks if '/other/' in k and is11(k)]
        groups=[normal_hw_s,normal_hw_a,normal_cum_s,normal_cum_a,normal_pre_s,normal_pre_a,normal_other,ep_hw_s,ep_hw_a,ep_cum_s,ep_cum_a,ep_pre_s,ep_pre_a,ep_other]
        flat=[x for g in groups for x in g]; assert len(flat)==len(set(flat)),f'Overlapping Y{year} {code}'
        unknown=sorted(set(ks)-set(flat)); assert not unknown,f'Unclassified Y{year} {code}: {unknown}'
        hw_pairs,hw_extra=pair_group(normal_hw_s,normal_hw_a,'homework',year)
        cum_pairs,cum_extra=pair_group(normal_cum_s,normal_cum_a,'homework',year)
        pre_pairs,pre_extra=pair_group(normal_pre_s,normal_pre_a,'sheet',year)
        ep_hw_pairs,ep_hw_extra=pair_group(ep_hw_s,ep_hw_a,'homework',year)
        ep_cum_pairs,ep_cum_extra=pair_group(ep_cum_s,ep_cum_a,'homework',year)
        ep_pre_pairs,ep_pre_extra=pair_group(ep_pre_s,ep_pre_a,'sheet',year)
        patched=copy.deepcopy(rec)
        for old in ('homeworks','preLessonSheets','otherResources'): patched.pop(old,None)
        core=patched.setdefault('core',{})
        core['homeworks']=[{'pairId':f'{lid}-hw-{i:02d}','homework':p.get('homework'),'answerPack':p.get('answerPack')} for i,p in enumerate(hw_pairs,1)]
        paired_pre_keys={p['sheet']['r2Key'] for p in pre_pairs if p.get('answerPack')}
        core['preLessonSheets']=[fileobj(k) for k in normal_pre_s if k not in paired_pre_keys]
        core['otherResources']=[fileobj(k) for k in normal_other]
        patched['phase11Resources']={
          'core':{'preLessonPairs':[p for p in pre_pairs if p.get('answerPack')],'cumulativeHomeworks':cum_pairs,'supplementaryAnswers':hw_extra+cum_extra+pre_extra},
          'elevenPlus':{'preLessonPairs':ep_pre_pairs,'homeworks':ep_hw_pairs,'cumulativeHomeworks':ep_cum_pairs,'supplementaryAnswers':ep_hw_extra+ep_cum_extra+ep_pre_extra},
          'vr':{'supplementaryAnswers':[]}
        }
        patched['phase11OtherResources']={'elevenPlus':[fileobj(k) for k in ep_other]}
        maths_refs={x for x in refs_in(patched) if x.startswith('maths/')}
        stale=sorted(maths_refs-current_set)
        assert not stale,f'Patched {lid} retains stale refs: {stale[:5]}'
        year_plans[lid]=patched; accounted.update(flat); per[code]=len(flat)
    assert accounted==current_set,f'Y{year} current R2 coverage mismatch missing={len(current_set-accounted)} extra={len(accounted-current_set)}'
    allrefs=set()
    for rec in year_plans.values(): allrefs.update(x for x in refs_in(rec) if x.startswith('maths/'))
    assert allrefs==current_set,f'Y{year} planned refs mismatch missing={len(current_set-allrefs)} extra={len(allrefs-current_set)}'
    plans[year]=year_plans
    reports[year]={'curriculum':curriculum,'lessonCount':len(lesson_ids),'currentR2ObjectCount':len(current),'plannedUniqueMathsRefs':len(allrefs),'perLessonObjectCount':per}

# Only write after all three years have passed the full deterministic plan checks.
for year,year_plans in plans.items():
    os.makedirs(f'y{year}maths-before',exist_ok=True); os.makedirs(f'y{year}maths-after',exist_ok=True)
    for lid,patched in year_plans.items():
        before=kvget('lesson:'+lid); json.dump(before,open(f'y{year}maths-before/{lid}.json','w'),indent=2,sort_keys=True)
        kvput('lesson:'+lid,patched); after=kvget('lesson:'+lid); assert after==patched
        json.dump(after,open(f'y{year}maths-after/{lid}.json','w'),indent=2,sort_keys=True)

# Independent post-write exact-current proof for each year.
for year,(curriculum,level,expected_objects) in YEARS.items():
    current={k for k in r2keys if k.startswith(f'maths/year{year}/L{level}T')}
    ids=kvget('curriculum:'+curriculum).get('lessonIds') or []
    refs=set()
    for lid in ids: refs.update(x for x in refs_in(kvget('lesson:'+lid)) if x.startswith('maths/'))
    assert refs==current,f'Post-write Y{year} refs mismatch missing={len(current-refs)} extra={len(refs-current)}'
    reports[year]['postWriteUniqueMathsRefs']=len(refs); reports[year]['brokenReferenceCount']=len([x for x in refs if x not in r2keys])
    assert reports[year]['brokenReferenceCount']==0
json.dump({'environment':env,'bucket':bucket,'years':reports},open('y4-y6-maths-resource-rebuild-report.json','w'),indent=2,sort_keys=True)
print('Y4_Y6_MATHS_RESOURCE_REBUILD_PASS')
