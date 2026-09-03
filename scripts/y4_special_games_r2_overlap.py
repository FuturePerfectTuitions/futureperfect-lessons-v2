#!/usr/bin/env python3
import json, os
from pathlib import PurePosixPath
import requests
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

SPECIALS = {
    "english_games": "18YKqMflTGUyrdEuQTalS-BAiQPGso_Gj",
    "maths_games": "1eZs8c0sBPAt-IIdDYtUtYvAsh6P5ladv",
}
FOLDER_MIME='application/vnd.google-apps.folder'
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
def children(fid): return dq(f"'{fid}' in parents and trashed=false")
def walk(fid,rel=''):
 out=[]
 for x in children(fid):
  if x.get('mimeType')==FOLDER_MIME: out+=walk(x['id'],rel+x['name']+'/')
  else:
   y=dict(x);y['relative_path']=rel+x['name'];out.append(y)
 return out
acct=os.environ['CLOUDFLARE_ACCOUNT_ID'];token=os.environ['CLOUDFLARE_API_TOKEN'];bucket=os.environ.get('R2_BUCKET','fpt-materials-dev')
base=f'https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{bucket}/objects';h={'Authorization':f'Bearer {token}'}
r2=[];cursor=None
while True:
 p={'per_page':'1000'}
 if cursor:p['cursor']=cursor
 r=requests.get(base,headers=h,params=p,timeout=120);r.raise_for_status();x=r.json()
 if not x.get('success'):raise RuntimeError(x)
 r2+=x.get('result') or [];ri=x.get('result_info') or {};cursor=ri.get('cursor') if ri.get('is_truncated') else None
 if not cursor:break
scoped=[o.get('key') or '' for o in r2 if ((o.get('key') or '').startswith('english/year4/') or (o.get('key') or '').startswith('maths/year4/')) and (o.get('key') or '') and not (o.get('key') or '').endswith('/')]
bybase={}
for k in scoped: bybase.setdefault(PurePosixPath(k).name,[]).append(k)
summary={'status':'pass','mode':'READ_ONLY_Y4_SPECIAL_GAMES_R2_OVERLAP','areas':{},'scoped_r2_file_count':len(scoped)}
for label,fid in SPECIALS.items():
 files=walk(fid); rows=[]; overlaps=[]
 for x in sorted(files,key=lambda y:y['relative_path'].lower()):
  rec={'id':x['id'],'name':x['name'],'relative_path':x['relative_path'],'size':x.get('size'),'mimeType':x.get('mimeType')}
  rows.append(rec)
  if x['name'] in bybase: overlaps.append({'drive':rec,'r2_keys':bybase[x['name']]})
 summary['areas'][label]={'folder_id':fid,'file_count':len(files),'files':rows,'exact_basename_overlap_count':len(overlaps),'exact_basename_overlaps':overlaps}
 print('Y4_SPECIAL_AREA',label,'FILES',len(files),'R2_BASENAME_OVERLAPS',len(overlaps),flush=True)
 for o in overlaps: print('Y4_SPECIAL_R2_OVERLAP',label,json.dumps(o,ensure_ascii=False,sort_keys=True),flush=True)
with open('y4-special-games-r2-overlap.json','w',encoding='utf-8') as f:json.dump(summary,f,indent=2,ensure_ascii=False,sort_keys=True);f.write('\n')
