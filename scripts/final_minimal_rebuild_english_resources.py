#!/usr/bin/env python3
import copy,json,os,re,urllib.parse,requests
from pathlib import PurePosixPath

YEAR=int(os.environ['TARGET_YEAR'])
EXPECTED_OBJECTS=int(os.environ.get('EXPECTED_R2_OBJECTS','0'))
EXPECTED_LESSONS=int(os.environ['EXPECTED_LESSONS'])
api='https://api.cloudflare.com/client/v4'
acct=os.environ['CLOUDFLARE_ACCOUNT_ID']; token=os.environ['CLOUDFLARE_API_TOKEN']; auth={'Authorization':f'Bearer {token}'}
worker='fpt-portal-v2-worker'; bucket='fpt-materials-dev'
settings=requests.get(f'{api}/accounts/{acct}/workers/scripts/{worker}/settings',headers=auth,timeout=60).json(); assert settings.get('success')
binds=settings['result']['bindings']; env=next(x.get('text') for x in binds if x.get('name')=='ENVIRONMENT'); r2bound=next(x.get('bucket_name') for x in binds if x.get('name')=='MATERIALS_R2'); ns=next(x.get('namespace_id') for x in binds if x.get('name')=='LESSONS_KV')
assert env=='development'; assert r2bound==bucket; assert ns
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
ykeys=sorted(k for k in r2keys if k.startswith(f'english/year{YEAR}/Y{YEAR}T'))
if EXPECTED_OBJECTS:
    assert len(ykeys)==EXPECTED_OBJECTS, f'Expected {EXPECTED_OBJECTS} current Y{YEAR} English R2 objects, found {len(ykeys)}'
else:
    assert ykeys, f'No current Y{YEAR} English R2 objects found'
cur=kvget(f'curriculum:ENGLISH_Y{YEAR}'); lesson_ids=cur.get('lessonIds') or []; assert len(lesson_ids)==EXPECTED_LESSONS
os.makedirs(f'y{YEAR}english-before',exist_ok=True); os.makedirs(f'y{YEAR}english-after',exist_ok=True)
CODE_RX=re.compile(fr'^Y{YEAR}T[123]E\d{{2}}$')
def code_for(rec):
    d=rec.get('displayIds') or {}; code=str(d.get(f'english-year{YEAR}') or '').strip(); assert CODE_RX.fullmatch(code),(rec.get('lessonId'),d); return code
def fname(k): return k.rsplit('/',1)[-1]
def fileobj(k): return {'displayName':fname(k),'r2Key':k}
def sig(k):
    s=PurePosixPath(fname(k)).stem.lower().replace('11+',' ')
    s=re.sub(r'\banswer\s*pack\b|\banswer\s*key\b|\banswers?\b',' ',s)
    s=re.sub(r'(vr[ph]?\d{2})a\b',r'\1',s)
    s=re.sub(fr'\b(?:y{YEAR}t[123]ee?\d{{2}}|y{YEAR}e\d+)\b',' ',s)
    s=re.sub(r'\b(?:homework|prelesson|pre\s*lesson|sheets?|set)\b',' ',s)
    s=re.sub(r'[^a-z0-9]+',' ',s).strip()
    return s
def pair_group(sheets,answers,primary_name):
    answers=list(sorted(answers)); used=set(); pairs=[]; bysig={}
    for a in answers: bysig.setdefault(sig(a),[]).append(a)
    for s in sorted(sheets):
        hits=[a for a in bysig.get(sig(s),[]) if a not in used]
        a=hits[0] if len(hits)==1 else None
        if a: used.add(a)
        pairs.append({primary_name:fileobj(s),'answerPack':fileobj(a) if a else None})
    leftovers=[fileobj(a) for a in answers if a not in used]
    return pairs,leftovers
def is11(k): return '11+' in fname(k).lower() or '/11plus/' in k.lower()
def iscumulative(k): return 'cumulative homework' in fname(k).lower()
accounted=set(); per_lesson={}; changed=[]
for lid in lesson_ids:
    rec=kvget('lesson:'+lid); assert rec.get('active') is not False
    code=code_for(rec); prefix=f'english/year{YEAR}/{code}/'; ks=sorted(k for k in ykeys if k.startswith(prefix))
    normal_hw_s=[k for k in ks if '/homework/sheets/' in k and '/vr/' not in k and '/11plus/' not in k and not is11(k) and not iscumulative(k)]
    normal_hw_a=[k for k in ks if '/homework/answers/' in k and '/vr/' not in k and '/11plus/' not in k and not is11(k) and not iscumulative(k)]
    normal_cum_s=[k for k in ks if '/homework/sheets/' in k and '/vr/' not in k and '/11plus/' not in k and not is11(k) and iscumulative(k)]
    normal_cum_a=[k for k in ks if '/homework/answers/' in k and '/vr/' not in k and '/11plus/' not in k and not is11(k) and iscumulative(k)]
    normal_pre_s=[k for k in ks if '/prelesson/sheets/' in k and '/vr/' not in k and '/11plus/' not in k and not is11(k)]
    normal_pre_a=[k for k in ks if '/prelesson/answers/' in k and '/vr/' not in k and '/11plus/' not in k and not is11(k)]
    normal_other=[k for k in ks if '/other/' in k and '/vr/' not in k and '/11plus/' not in k and not is11(k)]
    ep_hw_s=[k for k in ks if (('/homework/sheets/' in k and '/vr/' not in k and is11(k)) or '/11plus/homework/sheets/' in k) and not iscumulative(k)]
    ep_hw_a=[k for k in ks if (('/homework/answers/' in k and '/vr/' not in k and is11(k)) or '/11plus/homework/answers/' in k) and not iscumulative(k)]
    ep_cum_s=[k for k in ks if (('/homework/sheets/' in k and '/vr/' not in k and is11(k)) or '/11plus/homework/sheets/' in k) and iscumulative(k)]
    ep_cum_a=[k for k in ks if (('/homework/answers/' in k and '/vr/' not in k and is11(k)) or '/11plus/homework/answers/' in k) and iscumulative(k)]
    ep_pre_s=[k for k in ks if (('/prelesson/sheets/' in k and '/vr/' not in k and is11(k)) or '/11plus/prelesson/sheets/' in k)]
    ep_pre_a=[k for k in ks if (('/prelesson/answers/' in k and '/vr/' not in k and is11(k)) or '/11plus/prelesson/answers/' in k)]
    vr_hw_s=[k for k in ks if '/vr/homework/sheets/' in k]
    vr_hw_a=[k for k in ks if '/vr/homework/answers/' in k]
    vr_pre_s=[k for k in ks if '/vr/prelesson/sheets/' in k]
    vr_pre_a=[k for k in ks if '/vr/prelesson/answers/' in k]
    vr_other=[k for k in ks if '/vr/other/' in k]
    hw_pairs,hw_extra=pair_group(normal_hw_s,normal_hw_a,'homework')
    cum_pairs,cum_extra=pair_group(normal_cum_s,normal_cum_a,'homework')
    pre_pairs,pre_extra=pair_group(normal_pre_s,normal_pre_a,'sheet')
    ep_hw_pairs,ep_hw_extra=pair_group(ep_hw_s,ep_hw_a,'homework')
    ep_cum_pairs,ep_cum_extra=pair_group(ep_cum_s,ep_cum_a,'homework')
    ep_pre_pairs,ep_pre_extra=pair_group(ep_pre_s,ep_pre_a,'sheet')
    vr_hw_pairs,vr_hw_extra=pair_group(vr_hw_s+vr_other,vr_hw_a,'homework')
    vr_pre_pairs,vr_pre_extra=pair_group(vr_pre_s,vr_pre_a,'sheet')
    patched=copy.deepcopy(rec); core=patched.setdefault('core',{})
    core['homeworks']=[{'pairId':f'{lid}-hw-{i:02d}','homework':p.get('homework'),'answerPack':p.get('answerPack')} for i,p in enumerate(hw_pairs,1)]
    paired_pre_keys={p['sheet']['r2Key'] for p in pre_pairs if p.get('answerPack')}
    core['preLessonSheets']=[fileobj(k) for k in normal_pre_s if k not in paired_pre_keys]
    core['otherResources']=[fileobj(k) for k in normal_other]
    p11=patched.setdefault('phase11Resources',{})
    p11['core']={'preLessonPairs':[p for p in pre_pairs if p.get('answerPack')],'cumulativeHomeworks':cum_pairs,'supplementaryAnswers':hw_extra+cum_extra+pre_extra}
    p11['elevenPlus']={'preLessonPairs':ep_pre_pairs,'homeworks':ep_hw_pairs,'cumulativeHomeworks':ep_cum_pairs,'supplementaryAnswers':ep_hw_extra+ep_cum_extra+ep_pre_extra}
    # Obsolete phase11OtherResources paths are not part of the current reconciled R2 set.
    # Current ordinary 'other' resources are represented in core.otherResources above;
    # there are no current dedicated 11+ other-resource objects for the supported English years.
    patched['phase11OtherResources']={'elevenPlus':[]}
    oldvr=patched.get('vr') if isinstance(patched.get('vr'),dict) else {}
    patched['vr']={**{k:v for k,v in oldvr.items() if k in ('preLessonVideo','homeworkVideo','homeworkSolutionVideo')},'homeworks':[{'pairId':f'{lid}-vr-hw-{i:02d}','homework':p.get('homework'),'answerPack':p.get('answerPack')} for i,p in enumerate(vr_hw_pairs,1)],'preLesson':[{'pairId':f'{lid}-vr-pre-{i:02d}','sheet':p.get('sheet'),'answerKey':p.get('answerPack')} for i,p in enumerate(vr_pre_pairs,1)]}
    p11['vr']={'supplementaryAnswers':vr_hw_extra+vr_pre_extra}
    groups=[normal_hw_s,normal_hw_a,normal_cum_s,normal_cum_a,normal_pre_s,normal_pre_a,normal_other,ep_hw_s,ep_hw_a,ep_cum_s,ep_cum_a,ep_pre_s,ep_pre_a,vr_hw_s,vr_hw_a,vr_pre_s,vr_pre_a,vr_other]
    flat=[x for g in groups for x in g]; assert len(flat)==len(set(flat)), f'Overlapping classification {code}'
    unknown=sorted(set(ks)-set(flat)); assert not unknown, f'Unclassified Y{YEAR} English objects {code}: {unknown}'
    accounted.update(flat); per_lesson[code]=len(flat)
    json.dump(rec,open(f'y{YEAR}english-before/{lid}.json','w'),indent=2,sort_keys=True)
    kvput('lesson:'+lid,patched); after=kvget('lesson:'+lid); assert after==patched
    json.dump(after,open(f'y{YEAR}english-after/{lid}.json','w'),indent=2,sort_keys=True); changed.append(lid)
assert accounted==set(ykeys), f'Y{YEAR} English coverage mismatch'
refs=[]
def walk(x):
    if isinstance(x,dict):
        for k,v in x.items():
            if k=='r2Key' and isinstance(v,str) and v.strip(): refs.append(v.strip())
            else: walk(v)
    elif isinstance(x,list):
        for v in x: walk(v)
for lid in lesson_ids: walk(kvget('lesson:'+lid))
active_refs={k for k in refs if k.startswith(f'english/year{YEAR}/')}
assert active_refs==set(ykeys), f'Post-write Y{YEAR} English R2 coverage mismatch missing={len(set(ykeys)-active_refs)} extra={len(active_refs-set(ykeys))}'
assert not [k for k in active_refs if k not in r2keys]
report={'environment':env,'bucket':bucket,'year':YEAR,'lessonCount':len(lesson_ids),'currentR2ObjectCount':len(ykeys),'postWriteUniqueEnglishRefs':len(active_refs),'brokenReferenceCount':0,'perLessonObjectCount':per_lesson,'changedLessonIds':changed}
json.dump(report,open(f'y{YEAR}english-resource-rebuild-report.json','w'),indent=2,sort_keys=True)
print(f'Y{YEAR}_ENGLISH_RESOURCE_REBUILD_PASS',len(ykeys),'current R2 objects covered exactly')
