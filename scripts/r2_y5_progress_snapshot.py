#!/usr/bin/env python3
import json, os, re, requests
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
keys={o.get('key') or '' for o in out if (o.get('key') or '') and not (o.get('key') or '').endswith('/')}
current_re=re.compile(r'^(?:english/year5/Y5T[123]E\d{2}|maths/year5/L2T[123]M\d{2})/',re.I)
legacy_re=re.compile(r'^(?:english/year5/Y5E\d+|maths/year5/Y5M\d+)/',re.I)
y5={k for k in keys if k.startswith('english/year5/') or k.startswith('maths/year5/')}
current={k for k in y5 if current_re.match(k)}; legacy={k for k in y5 if legacy_re.match(k)}
other=y5-current-legacy
summary={'status':'pass','mode':'READ_ONLY_YEAR5_R2_PROGRESS','year5_file_count':len(y5),'current_target_family_count':len(current),'legacy_managed_count':len(legacy),'other_protected_count':len(other),'other_keys':sorted(other)}
print('Y5_PROGRESS_CURRENT',len(current),flush=True); print('Y5_PROGRESS_LEGACY',len(legacy),flush=True); print('Y5_PROGRESS_OTHER',len(other),flush=True)
open('y5-r2-progress.json','w').write(json.dumps(summary,indent=2)+'\n')
