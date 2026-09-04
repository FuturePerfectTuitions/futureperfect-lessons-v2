#!/usr/bin/env python3
import json, os, requests
from collections import Counter,defaultdict
acct=os.environ['CLOUDFLARE_ACCOUNT_ID']; token=os.environ['CLOUDFLARE_API_TOKEN']; bucket=os.environ.get('R2_BUCKET','fpt-materials-dev')
base=f'https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{bucket}/objects'; h={'Authorization':f'Bearer {token}'}
out=[]; cursor=None
while True:
 p={'per_page':'1000'}
 if cursor:p['cursor']=cursor
 r=requests.get(base,headers=h,params=p,timeout=120); r.raise_for_status(); j=r.json()
 if not j.get('success'): raise RuntimeError(j)
 out.extend(j.get('result') or []); info=j.get('result_info') or {}; cursor=info.get('cursor') if info.get('is_truncated') else None
 if not cursor: break
keys=sorted({o.get('key') or '' for o in out if (o.get('key') or '') and not (o.get('key') or '').endswith('/') and ((o.get('key') or '').startswith('english/year5/') or (o.get('key') or '').startswith('maths/year5/'))})
groups=defaultdict(list)
for k in keys:
 parts=k.split('/'); fam='/'.join(parts[:3]+([parts[3]] if len(parts)>3 else [])); groups[fam].append(k)
summary={'status':'pass','mode':'READ_ONLY_YEAR5_R2_NAMESPACE_INVENTORY','file_count':len(keys),'family_count':len(groups),'families':{k:{'count':len(v),'sample':v[:5]} for k,v in sorted(groups.items())},'keys':keys}
print('Y5_R2_FILE_COUNT',len(keys),flush=True); print('Y5_R2_FAMILY_COUNT',len(groups),flush=True)
for k,v in sorted(groups.items()): print('Y5_R2_FAMILY',k,len(v),flush=True)
open('y5-r2-namespace-inventory.json','w',encoding='utf-8').write(json.dumps(summary,indent=2,ensure_ascii=False)+'\n')
