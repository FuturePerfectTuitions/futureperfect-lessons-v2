#!/usr/bin/env python3
import json, os, re
from collections import defaultdict
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

ROOTS={
    "english":"1OBgXw-OmLuEZGkf0N8OjPKemHYzPk5ww",
    "maths":"1Ou-XT-wUFxEgUJ2N0Ojq5P67z4s-HkWy",
}
FOLDER="application/vnd.google-apps.folder"
EN_RE=re.compile(r"^Y6T[123]E\d{2}(?:\b| )",re.I)
MA_RE=re.compile(r"^L3T[123]M\d{2}(?:\b| )",re.I)
info=json.loads(os.environ["GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"])
creds=service_account.Credentials.from_service_account_info(info,scopes=["https://www.googleapis.com/auth/drive.readonly"])
drive=AuthorizedSession(creds)

def children(fid):
    out=[]; token=None
    while True:
        p={"q":f"'{fid}' in parents and trashed=false","fields":"nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,parents)","pageSize":"1000","supportsAllDrives":"true","includeItemsFromAllDrives":"true"}
        if token:p["pageToken"]=token
        r=drive.get("https://www.googleapis.com/drive/v3/files",params=p,timeout=120); r.raise_for_status()
        j=r.json(); out.extend(j.get("files",[])); token=j.get("nextPageToken")
        if not token:return out

summary={"status":"running","mode":"READ_ONLY_YEAR6_EXACT_DUPLICATE_FILENAME_AUDIT","lesson_count":0,"duplicates":[],"error":None}
try:
    lessons=[]
    for subject,root in ROOTS.items():
        rx=EN_RE if subject=="english" else MA_RE
        for x in children(root):
            if x.get("mimeType")==FOLDER and rx.match(x.get("name") or ""):
                lessons.append((subject,x))
    summary["lesson_count"]=len(lessons)
    if len(lessons)!=74: raise RuntimeError(f"Expected 74 current Year 6 ordinary lessons, got {len(lessons)}")
    for subject,lesson in sorted(lessons,key=lambda t:t[1]["name"].lower()):
        groups=defaultdict(list)
        for x in children(lesson["id"]):
            if x.get("mimeType")!=FOLDER:
                groups[x.get("name") or ""].append(x)
        for name,items in groups.items():
            if len(items)>1:
                rec={"subject":subject,"lesson":lesson["name"],"lesson_id":lesson["id"],"filename":name,"count":len(items),"files":[{"id":x["id"],"size":int(x.get("size") or 0),"createdTime":x.get("createdTime"),"modifiedTime":x.get("modifiedTime")} for x in sorted(items,key=lambda z:(int(z.get("size") or 0),z["id"]))]}
                summary["duplicates"].append(rec)
                print("Y6_DUPLICATE",lesson["name"],name,"COUNT",len(items),"SIZES",[f["size"] for f in rec["files"]],flush=True)
    summary["duplicate_group_count"]=len(summary["duplicates"])
    summary["status"]="pass"
    print("Y6_DUPLICATE_AUDIT_PASS LESSONS",len(lessons),"DUPLICATE_GROUPS",len(summary["duplicates"]),flush=True)
except Exception as e:
    summary["status"]="fail"; summary["error"]=f"{type(e).__name__}: {e}"; print("Y6_DUPLICATE_AUDIT_FAIL",summary["error"],flush=True); raise
finally:
    with open("y6-duplicate-name-audit.json","w",encoding="utf-8") as f: json.dump(summary,f,indent=2,ensure_ascii=False); f.write("\n")
