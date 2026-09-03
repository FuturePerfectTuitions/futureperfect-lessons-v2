#!/usr/bin/env python3
import json, os, re
from collections import defaultdict
from pathlib import PurePosixPath
import requests
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

ENGLISH_FOLDER_ID='1OYFPtGBb9Io7dwiuIvdMYsvJnb2TczXb'
MATHS_FOLDER_ID='1OzjeIf6BaFqEL8dCleM9ad3K-A1WtONw'
FOLDER_MIME='application/vnd.google-apps.folder'
ORD_RE=re.compile(r'^(Y4T([123])E(\d{2}))(?=$|[^A-Za-z0-9])(.*)$',re.I)
EE_RE=re.compile(r'^(Y4T([123])EE(\d{2}))(?=$|[^A-Za-z0-9])(.*)$',re.I)
M_RE=re.compile(r'^(L1T([123])M(\d{2}))(?=$|[^A-Za-z0-9])(.*)$',re.I)
ORD_RANGES={1:range(1,11),2:range(11,24),3:range(24,35)}
M_RANGES={1:range(1,14),2:range(14,23),3:range(23,37)}
CODE_RE=re.compile(r'Y4T[123]EE\d{2}|Y4T[123]E\d{2}|L1T[123]M\d{2}',re.I)
STOP={'answer','pack','key','homework','sheet','sheets','prelesson','pre','lesson','vr','11','plus','pdf','set','part','week','the','and','from','year','to','of','in','a','an'}

def norm_tokens(s):
 s=s.lower().replace('&',' and ')
 s=re.sub(r"y4t[123]ee\d{2}|y4t[123]e\d{2}|l1t[123]m\d{2}|y4e\d+",' ',s)
 s=re.sub(r'\b(?:far|pri|pin|rut|dip|pur)\d+[a-z0-9]*\b',' ',s)
 s=re.sub(r'[^a-z0-9]+',' ',s)
 return {x for x in s.split() if x not in STOP and len(x)>1 and not x.isdigit()}

info=json.loads(os.environ['GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON'])
creds=service_account.Credentials.from_service_account_info(info,scopes=['https://www.googleapis.com/auth/drive.readonly'])
drive=AuthorizedSession(creds)
def dq(q):
 out=[];token=None
 while True:
  p={'q':q,'fields':'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,trashed)','pageSize':'1000','supportsAllDrives':'true','includeItemsFromAllDrives':'true'}
  if token:p['pageToken']=token
  r=drive.get('https://www.googleapis.com/drive/v3/files',params=p,timeout=120);r.raise_for_status();x=r.json();out+=x.get('files',[]);token=x.get('nextPageToken')
  if not token:return out
def children(fid):return dq(f"'{fid}' in parents and trashed=false")
def walk(fid,rel=''):
 out=[]
 for x in children(fid):
  if x.get('mimeType')==FOLDER_MIME:out+=walk(x['id'],rel+x['name']+'/')
  else:
   y=dict(x);y['relative_path']=rel+x['name'];out.append(y)
 return out

def lessons():
 out=[]
 for x in children(ENGLISH_FOLDER_ID):
  if x.get('mimeType')!=FOLDER_MIME:continue
  n=x['name'];m=EE_RE.match(n)
  if m:out.append({'code':m.group(1).upper(),'title':(m.group(4) or '').strip(' -–—'),'kind':'ee','id':x['id']});continue
  m=ORD_RE.match(n)
  if m:
   t,s=int(m.group(2)),int(m.group(3))
   if s in ORD_RANGES[t]:out.append({'code':m.group(1).upper(),'title':(m.group(4) or '').strip(' -–—'),'kind':'ordinary','id':x['id']})
 for x in children(MATHS_FOLDER_ID):
  if x.get('mimeType')!=FOLDER_MIME:continue
  n=x['name'];m=M_RE.match(n)
  if m:
   t,s=int(m.group(2)),int(m.group(3))
   if s in M_RANGES[t]:out.append({'code':m.group(1).upper(),'title':(m.group(4) or '').strip(' -–—'),'kind':'maths','id':x['id']})
 for l in out:
  fs=walk(l['id']); l['drive_file_names']=[f['name'] for f in fs];l['drive_alias_codes']=sorted({c.upper() for f in fs for c in CODE_RE.findall(f['name'])});l['title_tokens']=sorted(norm_tokens(l['title']))
 return out

ls=lessons(); bycode={l['code']:l for l in ls}; alias_to_current=defaultdict(set)
for l in ls:
 for c in l['drive_alias_codes']:alias_to_current[c].add(l['code'])

acct=os.environ['CLOUDFLARE_ACCOUNT_ID'];token=os.environ['CLOUDFLARE_API_TOKEN'];bucket=os.environ.get('R2_BUCKET','fpt-materials-dev')
base=f'https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{bucket}/objects';h={'Authorization':f'Bearer {token}'};objs=[];cursor=None
while True:
 p={'per_page':'1000'}
 if cursor:p['cursor']=cursor
 r=requests.get(base,headers=h,params=p,timeout=120);r.raise_for_status();x=r.json()
 if not x.get('success'):raise RuntimeError(x)
 objs+=x.get('result') or [];ri=x.get('result_info') or {};cursor=ri.get('cursor') if ri.get('is_truncated') else None
 if not cursor:break
scoped=[o.get('key') or '' for o in objs if (o.get('key') or '').startswith('english/year4/') and (o.get('key') or '') and not (o.get('key') or '').endswith('/')]
byfam=defaultdict(list)
for k in scoped:
 p=k.split('/')
 if len(p)>=3 and re.fullmatch(r'Y4E\d+',p[2],re.I):byfam[p[2].upper()].append(k)

rows=[];ambiguous=[]
for fam,keys in sorted(byfam.items(),key=lambda kv:int(re.search(r'\d+',kv[0]).group())):
 names=[PurePosixPath(k).name for k in keys]; text=' '.join(names); codes=sorted({c.upper() for n in names for c in CODE_RE.findall(n)})
 mapped=set()
 for c in codes:
  if c in bycode:mapped.add(c)
  mapped.update(alias_to_current.get(c,set()))
 fam_tokens=norm_tokens(text)
 title_scores=[]
 for l in ls:
  tt=set(l['title_tokens'])
  if not tt:continue
  inter=len(tt & fam_tokens);score=inter/len(tt)
  if score>=0.60 and inter>=1:title_scores.append((score,len(tt),l['code'],l['title']))
 if title_scores:
  best=max(x[0] for x in title_scores)
  for score,_,code,_ in title_scores:
   if score>=max(0.75,best-0.05):mapped.add(code)
 row={'legacy_r2_family':fam,'r2_file_count':len(keys),'historical_or_current_codes_found':codes,'mapped_current_codes':sorted(mapped),'mapped_current_lessons':[{'code':c,'title':bycode[c]['title'],'kind':bycode[c]['kind']} for c in sorted(mapped) if c in bycode],'sample_r2_filenames':names[:8]}
 if not mapped:
  row['status']='UNRESOLVED';ambiguous.append(fam)
 else:row['status']='MAPPED'
 rows.append(row)
 print('Y4_SEMANTIC_MAP',fam,'=>',','.join(sorted(mapped)) or 'UNRESOLVED',flush=True)
summary={'status':'pass' if not ambiguous else 'review_required','mode':'READ_ONLY_Y4_R2_SEMANTIC_MAPPING_AUDIT','current_lesson_count':len(ls),'legacy_r2_family_count':len(rows),'unresolved_families':ambiguous,'mappings':rows}
with open('y4-r2-semantic-mapping-audit.json','w',encoding='utf-8') as f:json.dump(summary,f,indent=2,ensure_ascii=False,sort_keys=True);f.write('\n')
if ambiguous:raise RuntimeError('Unresolved legacy R2 semantic families: '+','.join(ambiguous))
