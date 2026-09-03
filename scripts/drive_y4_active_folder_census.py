#!/usr/bin/env python3
import json, os, re
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account
ROOT="1FG_SZKaf3BVqKMpt3eb_wHI4L4POUX-y"
FOLDER="application/vnd.google-apps.folder"
info=json.loads(os.environ["GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"])
creds=service_account.Credentials.from_service_account_info(info,scopes=["https://www.googleapis.com/auth/drive.readonly"])
drive=AuthorizedSession(creds); cache={}
def dq(q):
    out=[]; token=None
    while True:
        p={"q":q,"fields":"nextPageToken,files(id,name,mimeType,parents,trashed,modifiedTime)","pageSize":"1000","supportsAllDrives":"true","includeItemsFromAllDrives":"true"}
        if token:p["pageToken"]=token
        r=drive.get("https://www.googleapis.com/drive/v3/files",params=p,timeout=120);r.raise_for_status();x=r.json();out+=x.get("files",[]);token=x.get("nextPageToken")
        if not token:return out
def md(fid):
    if fid in cache:return cache[fid]
    r=drive.get(f"https://www.googleapis.com/drive/v3/files/{fid}",params={"fields":"id,name,mimeType,parents,trashed","supportsAllDrives":"true"},timeout=120);r.raise_for_status();cache[fid]=r.json();return cache[fid]
def ancestry(item):
    q=[(p,[]) for p in item.get("parents") or []]; seen=set()
    while q:
        pid,path=q.pop(0)
        if pid in seen:continue
        seen.add(pid)
        if pid==ROOT:return True,path
        m=md(pid);n=m.get("name") or "";q += [(pp,path+[n]) for pp in m.get("parents") or []]
    return False,[]
rows=[]
for x in dq("mimeType='application/vnd.google-apps.folder' and name contains 'Y4' and trashed=false"):
    if not re.match(r"^Y4",x.get("name") or "",re.I):continue
    inside,anc=ancestry(x)
    if not inside:continue
    obsolete=any(a.strip().lower()=="obsolete lessons" for a in anc)
    rows.append({"id":x["id"],"name":x["name"],"ancestor_names":anc,"obsolete":obsolete})
rows.sort(key=lambda r:(r["obsolete"],r["name"].lower(),r["id"]))
active=[r for r in rows if not r["obsolete"]]
summary={"status":"pass","year":4,"mode":"READ_ONLY_ACTIVE_FOLDER_CENSUS","active_count":len(active),"obsolete_count":len(rows)-len(active),"active_folders":active,"obsolete_folders":[r for r in rows if r["obsolete"]]}
for r in active:print("Y4_ACTIVE_FOLDER",json.dumps(r,ensure_ascii=False,sort_keys=True),flush=True)
print("Y4_ACTIVE_FOLDER_COUNT",len(active),flush=True)
with open("y4-active-folder-census.json","w",encoding="utf-8") as f:json.dump(summary,f,indent=2,ensure_ascii=False,sort_keys=True);f.write("\n")
