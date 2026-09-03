#!/usr/bin/env python3
import json, os
from collections import Counter,defaultdict
import requests
acct=os.environ['CLOUDFLARE_ACCOUNT_ID'];token=os.environ['CLOUDFLARE_API_TOKEN'];bucket=os.environ.get('R2_BUCKET','fpt-materials-dev')
base=f'https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{bucket}/objects';h={'Authorization':f'Bearer {token}'}
out=[];cursor=None
while True:
    p={'per_page':'1000'}
    if cursor:p['cursor']=cursor
    r=requests.get(base,headers=h,params=p,timeout=120);r.raise_for_status();x=r.json()
    if not x.get('success'):raise RuntimeError(x)
    out+=x.get('result') or [];ri=x.get('result_info') or {};cursor=ri.get('cursor') if ri.get('is_truncated') else None
    if not cursor:break
keys=sorted((o.get('key') or '') for o in out if ((o.get('key') or '').startswith('english/year4/') or (o.get('key') or '').startswith('maths/year4/')) and (o.get('key') or '') and not (o.get('key') or '').endswith('/'))
fams=Counter();by=defaultdict(list)
for k in keys:
    p=k.split('/');fam='/'.join(p[:4]) if len(p)>=4 else k;fams[fam]+=1;by[fam].append(k)
summary={'status':'pass','mode':'READ_ONLY_R2_Y4_PATH_INVENTORY','file_count':len(keys),'family_counts':dict(sorted(fams.items())),'keys_by_family':dict(sorted(by.items()))}
print('Y4_R2_FILE_COUNT',len(keys),flush=True)
for fam,c in sorted(fams.items()):print('Y4_R2_FAMILY',fam,c,flush=True)
with open('y4-r2-path-inventory.json','w',encoding='utf-8') as f:json.dump(summary,f,indent=2,ensure_ascii=False,sort_keys=True);f.write('\n')
