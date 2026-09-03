#!/usr/bin/env python3
import json, os
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account
FOLDER_ID='1OzjeIf6BaFqEL8dCleM9ad3K-A1WtONw'
info=json.loads(os.environ['GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON'])
creds=service_account.Credentials.from_service_account_info(info,scopes=['https://www.googleapis.com/auth/drive.readonly'])
drive=AuthorizedSession(creds)
out=[];token=None
while True:
    p={'q':f"'{FOLDER_ID}' in parents and trashed=false",'fields':'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,trashed)','pageSize':'1000','supportsAllDrives':'true','includeItemsFromAllDrives':'true'}
    if token:p['pageToken']=token
    r=drive.get('https://www.googleapis.com/drive/v3/files',params=p,timeout=120);r.raise_for_status();x=r.json();out+=x.get('files',[]);token=x.get('nextPageToken')
    if not token:break
out.sort(key=lambda x:(x.get('name','').lower(),x['id']))
summary={'status':'pass','mode':'READ_ONLY_Y4_MATH_DIRECT_CHILDREN','folder_id':FOLDER_ID,'count':len(out),'children':out}
for x in out:print('Y4_MATH_CHILD',json.dumps({'id':x['id'],'name':x['name'],'mimeType':x.get('mimeType'),'size':x.get('size')},ensure_ascii=False,sort_keys=True),flush=True)
with open('y4-math-direct-children.json','w',encoding='utf-8') as f:json.dump(summary,f,indent=2,ensure_ascii=False,sort_keys=True);f.write('\n')
