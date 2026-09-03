#!/usr/bin/env python3
import json, os, re
from pathlib import PurePosixPath
import requests
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

ENGLISH_FOLDER_ID='1OYFPtGBb9Io7dwiuIvdMYsvJnb2TczXb'
MATHS_FOLDER_ID='1OzjeIf6BaFqEL8dCleM9ad3K-A1WtONw'
FOLDER_MIME='application/vnd.google-apps.folder'
PPT={'.ppt','.pptx','.pptm','.pps','.ppsx','.ppsm','.pot','.potx','.potm','.ppa','.ppam','.sldx','.sldm'}
ORD_RE=re.compile(r'^(Y4T([123])E(\d{2}))(?=$|[^A-Za-z0-9])(.*)$',re.I)
EE_RE=re.compile(r'^(Y4T([123])EE(\d{2}))(?=$|[^A-Za-z0-9])(.*)$',re.I)
M_RE=re.compile(r'^(L1T([123])M(\d{2}))(?=$|[^A-Za-z0-9])(.*)$',re.I)
OLD_PREFIX_RE=re.compile(r'^(?:Y4T[123]EE\d{2}|Y4T[123]E\d{2}|Y4E\d+|L1T[123]M\d{2}|Y4M\d+)',re.I)
ORD_RANGES={1:range(1,11),2:range(11,24),3:range(24,35)}
M_RANGES={1:range(1,14),2:range(14,23),3:range(23,37)}
EXPECTED_EE={
 'Y4T1EE03','Y4T1EE04','Y4T1EE05','Y4T1EE06','Y4T1EE07','Y4T1EE09',
 'Y4T2EE01','Y4T2EE04','Y4T2EE05','Y4T2EE06','Y4T2EE07','Y4T2EE08',
 'Y4T2EE09','Y4T2EE10','Y4T2EE11','Y4T2EE12','Y4T2EE13'
}

def exact(name,code): return re.match(r'^'+re.escape(code)+r'(?=$|[^A-Za-z0-9])',name,re.I) is not None
def ext(name): return PurePosixPath(name.lower()).suffix
def pathparts(rel): return [p.strip() for p in PurePosixPath(rel).parts[:-1]]
def is_vr(rel):
    for p in pathparts(rel):
        q=re.sub(r'[-_]',' ',p.lower()).strip()
        if q=='vr' or q.startswith('vr ') or 'verbal reasoning' in q: return True
    return False
def is_11(rel):
    for p in pathparts(rel):
        q=p.lower().replace(' ','')
        if '11+' in p.lower() or '11plus' in q: return True
    return False
def classify(rel,name,kind):
    low=(rel+' '+name).lower(); vr=is_vr(rel); prefix='vr/' if vr else ('11plus/' if kind=='ee' or is_11(rel) else '')
    ans='answer pack' in low or 'answer key' in low or 'answerpack' in low
    pre='prelesson' in low or 'pre-lesson' in low or 'pre lesson' in low or bool(re.search(r'vrp\d',low,re.I))
    hw='homework' in low or bool(re.search(r'vrh\d',low,re.I))
    if ans and pre: leaf='prelesson/answers'
    elif ans: leaf='homework/answers'
    elif pre: leaf='prelesson/sheets'
    elif hw: leaf='homework/sheets'
    else: leaf='other'
    return prefix+leaf

def target_name(source_name,code,vr):
    if exact(source_name,code): return source_name
    if not vr: raise RuntimeError('Non-VR accepted file without current-code prefix: '+source_name)
    m=OLD_PREFIX_RE.match(source_name)
    if m: return code+source_name[m.end():]
    return code+' '+source_name

info=json.loads(os.environ['GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON'])
creds=service_account.Credentials.from_service_account_info(info,scopes=['https://www.googleapis.com/auth/drive.readonly'])
drive=AuthorizedSession(creds)
def dq(q):
    out=[]; token=None
    while True:
        p={'q':q,'fields':'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,trashed)','pageSize':'1000','supportsAllDrives':'true','includeItemsFromAllDrives':'true'}
        if token:p['pageToken']=token
        r=drive.get('https://www.googleapis.com/drive/v3/files',params=p,timeout=120);r.raise_for_status();x=r.json();out+=x.get('files',[]);token=x.get('nextPageToken')
        if not token:return out
def children(fid): return dq(f"'{fid}' in parents and trashed=false")
def walk(fid,rel=''):
    out=[]
    for x in children(fid):
        if x.get('mimeType')==FOLDER_MIME: out+=walk(x['id'],rel+x['name']+'/')
        else:
            y=dict(x);y['relative_path']=rel+x['name'];out.append(y)
    return out

def discover():
    out=[]; ordinary=set(); ee=set(); maths=set()
    for x in children(ENGLISH_FOLDER_ID):
        if x.get('mimeType')!=FOLDER_MIME: continue
        n=x['name']; m=EE_RE.match(n)
        if m:
            code=m.group(1).upper(); ee.add(code); out.append({'code':code,'subject':'english','kind':'ee','id':x['id'],'title':(m.group(4) or '').strip(' -–—')}); continue
        m=ORD_RE.match(n)
        if m:
            t,s=int(m.group(2)),int(m.group(3)); code=m.group(1).upper()
            if s in ORD_RANGES[t]: ordinary.add(code); out.append({'code':code,'subject':'english','kind':'ordinary','id':x['id'],'title':(m.group(4) or '').strip(' -–—')})
    for x in children(MATHS_FOLDER_ID):
        if x.get('mimeType')!=FOLDER_MIME: continue
        n=x['name']; m=M_RE.match(n)
        if m:
            t,s=int(m.group(2)),int(m.group(3)); code=m.group(1).upper()
            if s in M_RANGES[t]: maths.add(code); out.append({'code':code,'subject':'maths','kind':'ordinary','id':x['id'],'title':(m.group(4) or '').strip(' -–—')})
    exp_ord={f'Y4T{t}E{s:02d}' for t,vals in ORD_RANGES.items() for s in vals}
    exp_m={f'L1T{t}M{s:02d}' for t,vals in M_RANGES.items() for s in vals}
    if ordinary!=exp_ord: raise RuntimeError(f'Ordinary set mismatch missing={sorted(exp_ord-ordinary)} extra={sorted(ordinary-exp_ord)}')
    if maths!=exp_m: raise RuntimeError(f'Maths set mismatch missing={sorted(exp_m-maths)} extra={sorted(maths-exp_m)}')
    if ee!=EXPECTED_EE: raise RuntimeError(f'EE set mismatch missing={sorted(EXPECTED_EE-ee)} extra={sorted(ee-EXPECTED_EE)}')
    return sorted(out,key=lambda x:(x['subject'],x['kind'],x['code']))

def list_r2():
    acct=os.environ['CLOUDFLARE_ACCOUNT_ID']; token=os.environ['CLOUDFLARE_API_TOKEN']; bucket=os.environ.get('R2_BUCKET','fpt-materials-dev')
    base=f'https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{bucket}/objects'; h={'Authorization':f'Bearer {token}'}; out=[]; cursor=None
    while True:
        p={'per_page':'1000'}
        if cursor:p['cursor']=cursor
        r=requests.get(base,headers=h,params=p,timeout=120);r.raise_for_status();x=r.json()
        if not x.get('success'):raise RuntimeError(x)
        out+=x.get('result') or [];ri=x.get('result_info') or {};cursor=ri.get('cursor') if ri.get('is_truncated') else None
        if not cursor:return out

lessons=discover(); expected={}; renamed=[]; exclusions=[]; accepted_count=0
for l in lessons:
    code=l['code']
    for x in sorted(walk(l['id']),key=lambda y:y['relative_path'].lower()):
        rel=x['relative_path']; vr=is_vr(rel)
        if ext(x['name']) in PPT:
            exclusions.append({'lesson':code,'name':x['name'],'relative_path':rel,'reason':'POWERPOINT_OWNER_EXCLUDED'}); continue
        if not vr and not exact(x['name'],code):
            exclusions.append({'lesson':code,'name':x['name'],'relative_path':rel,'reason':'NON_CURRENT_CODE_OUTSIDE_VR'}); continue
        tn=target_name(x['name'],code,vr)
        if not exact(tn,code): raise RuntimeError(f'Target filename does not begin current code: {code} -> {tn}')
        cat=classify(rel,x['name'],l['kind']); key=f"{l['subject']}/year4/{code}/{cat}/{tn}"
        if key in expected: raise RuntimeError('Duplicate target key '+key)
        rec={'lesson_code':code,'subject':l['subject'],'kind':l['kind'],'source_drive_name':x['name'],'target_r2_name':tn,'relative_path':rel,'category':cat,'key':key,'drive_id':x['id'],'size':int(x['size']) if x.get('size') is not None else None,'renamed':tn!=x['name']}
        expected[key]=rec; accepted_count+=1
        if tn!=x['name']: renamed.append(rec)
scoped=sorted((o.get('key') or '') for o in list_r2() if ((o.get('key') or '').startswith('english/year4/') or (o.get('key') or '').startswith('maths/year4/')) and (o.get('key') or '') and not (o.get('key') or '').endswith('/'))
summary={'status':'pass','mode':'READ_ONLY_Y4_FINAL_TARGET_FILENAME_AUDIT','lesson_count':len(lessons),'ordinary_english_count':34,'ee_11plus_count':17,'maths_count':36,'accepted_file_count':accepted_count,'renamed_target_filename_count':len(renamed),'renamed_target_filenames':renamed,'excluded_file_count':len(exclusions),'excluded_files':exclusions,'expected_target_key_count':len(expected),'expected_target_keys':sorted(expected),'current_scoped_r2_count':len(scoped),'already_present_target_keys':sorted(set(expected)&set(scoped)),'missing_target_keys':sorted(set(expected)-set(scoped)),'unsupported_current_scoped_keys':sorted(set(scoped)-set(expected))}
print('Y4_TARGET_NAME_AUDIT_PASS')
print('Y4_LESSONS',len(lessons),'ORDINARY_ENGLISH',34,'EE',17,'MATHS',36)
print('Y4_ACCEPTED_FILES',accepted_count,'RENAMED_FILENAMES',len(renamed),'EXCLUDED',len(exclusions))
print('Y4_EXPECTED_KEYS',len(expected),'CURRENT_R2',len(scoped),'MISSING',len(set(expected)-set(scoped)),'UNSUPPORTED',len(set(scoped)-set(expected)))
for r in renamed: print('Y4_FILENAME_RENAME',r['lesson_code'],json.dumps(r['source_drive_name'],ensure_ascii=False),'->',json.dumps(r['target_r2_name'],ensure_ascii=False))
with open('y4-final-target-filename-audit.json','w',encoding='utf-8') as f:json.dump(summary,f,indent=2,ensure_ascii=False,sort_keys=True);f.write('\n')
