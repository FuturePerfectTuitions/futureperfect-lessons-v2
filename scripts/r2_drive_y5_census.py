#!/usr/bin/env python3
import json, os
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

ROOTS={"english":"1OKpYKW8gBxBijwFqfYQ5LwF9xp4-Eiwa","maths":"1OvQmVd3Xlq_nUMQRyJdUQxKbuHy1gogA"}
FOLDER="application/vnd.google-apps.folder"
info=json.loads(os.environ["GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"])
creds=service_account.Credentials.from_service_account_info(info,scopes=["https://www.googleapis.com/auth/drive.readonly"])
drive=AuthorizedSession(creds)

def children(fid):
    q=f"'{fid}' in parents and trashed=false"
    out=[]; token=None
    while True:
        p={"q":q,"fields":"nextPageToken,files(id,name,mimeType,size,modifiedTime,parents)","pageSize":"1000","supportsAllDrives":"true","includeItemsFromAllDrives":"true"}
        if token:p["pageToken"]=token
        r=drive.get("https://www.googleapis.com/drive/v3/files",params=p,timeout=120); r.raise_for_status()
        j=r.json(); out.extend(j.get("files",[])); token=j.get("nextPageToken")
        if not token:return out

summary={"status":"pass","mode":"READ_ONLY_YEAR5_DIRECT_CHILD_CENSUS","roots":ROOTS,"subjects":{}}
for subject,fid in ROOTS.items():
    items=children(fid)
    folders=sorted([{"id":x["id"],"name":x["name"]} for x in items if x.get("mimeType")==FOLDER],key=lambda x:x["name"].lower())
    files=sorted([{"id":x["id"],"name":x["name"],"mimeType":x.get("mimeType"),"size":x.get("size")} for x in items if x.get("mimeType")!=FOLDER],key=lambda x:x["name"].lower())
    summary["subjects"][subject]={"folder_count":len(folders),"file_count":len(files),"folders":folders,"files":files}
    print("Y5_CENSUS",subject,"FOLDERS",len(folders),"FILES",len(files),flush=True)
    for x in folders: print(subject.upper(),x["name"],x["id"],flush=True)
with open("y5-drive-direct-child-census.json","w",encoding="utf-8") as f: json.dump(summary,f,indent=2,ensure_ascii=False); f.write("\n")
