#!/usr/bin/env python3
import json
import os
import re
from collections import defaultdict
from pathlib import PurePosixPath
import requests
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

ROOT_LESSONS_ID = "1FG_SZKaf3BVqKMpt3eb_wHI4L4POUX-y"
R2_BUCKET = "fpt-materials-dev"
FOLDER_MIME = "application/vnd.google-apps.folder"
POWERPOINT_EXTENSIONS = {".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".ppsm", ".pot", ".potx", ".potm", ".ppa", ".ppam", ".sldx", ".sldm"}
LESSON_RE = re.compile(r"^(Y3T([123])([EM])(\d{2}))(?=$|[^A-Za-z0-9])(.*)$", re.I)


def exact_prefix(name, code):
    return re.match(r"^" + re.escape(code) + r"(?=$|[^A-Za-z0-9])", name, re.I) is not None

def ext(name): return PurePosixPath(name.lower()).suffix

def classify(name):
    n=name.lower()
    if "answer pack" in n or "answer key" in n: return "homework/answers"
    if "prelesson" in n or "pre-lesson" in n or "pre lesson" in n: return "prelesson/sheets"
    if "homework" in n: return "homework/sheets"
    return "other"

info=json.loads(os.environ["GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"])
creds=service_account.Credentials.from_service_account_info(info,scopes=["https://www.googleapis.com/auth/drive.readonly"])
drive=AuthorizedSession(creds)
metadata={}

def dq(q):
    out=[]; token=None
    while True:
        p={"q":q,"fields":"nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,trashed)","pageSize":"1000","supportsAllDrives":"true","includeItemsFromAllDrives":"true"}
        if token:p["pageToken"]=token
        r=drive.get("https://www.googleapis.com/drive/v3/files",params=p,timeout=120); r.raise_for_status(); x=r.json(); out+=x.get("files",[]); token=x.get("nextPageToken")
        if not token:return out

def md(fid):
    if fid in metadata:return metadata[fid]
    r=drive.get(f"https://www.googleapis.com/drive/v3/files/{fid}",params={"fields":"id,name,mimeType,size,modifiedTime,parents,trashed","supportsAllDrives":"true"},timeout=120);r.raise_for_status();metadata[fid]=r.json();return metadata[fid]

def active(item):
    q=list(item.get("parents") or []); seen=set(); names=[]
    while q:
        p=q.pop(0)
        if p in seen:continue
        seen.add(p)
        if p==ROOT_LESSONS_ID:return not any(n.strip().lower()=="obsolete lessons" for n in names),names
        m=md(p);names.append(m.get("name") or "");q+=m.get("parents") or []
    return False,names

def children(fid): return dq(f"'{fid.replace(chr(39), chr(92)+chr(39))}' in parents and trashed=false")
def walk(fid,rel=""):
    out=[]
    for x in children(fid):
        if x.get("mimeType")==FOLDER_MIME:out+=walk(x["id"],rel+x["name"]+"/")
        else:
            y=dict(x);y["relative_path"]=rel+x["name"];out.append(y)
    return out

def list_r2():
    acct=os.environ["CLOUDFLARE_ACCOUNT_ID"];token=os.environ["CLOUDFLARE_API_TOKEN"]
    base=f"https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{os.environ.get('R2_BUCKET',R2_BUCKET)}/objects";h={"Authorization":f"Bearer {token}"};out=[];cursor=None
    while True:
        p={"per_page":"1000"}
        if cursor:p["cursor"]=cursor
        r=requests.get(base,headers=h,params=p,timeout=120);r.raise_for_status();x=r.json()
        if not x.get("success"):raise RuntimeError(x)
        out+=x.get("result") or [];ri=x.get("result_info") or {};cursor=ri.get("cursor") if ri.get("is_truncated") else None
        if not cursor:return out

summary={"status":"running","mode":"READ_ONLY_STRUCTURE_PREFLIGHT","year":3,"lessons":[],"obsolete_or_outside":[],"error":None}
try:
    by=defaultdict(list)
    for item in dq("mimeType='application/vnd.google-apps.folder' and name contains 'Y3T' and trashed=false"):
        m=LESSON_RE.match(item.get("name") or "")
        if not m:continue
        ok,anc=active(item);rec={"code":m.group(1).upper(),"term":int(m.group(2)),"subject_letter":m.group(3).upper(),"serial":int(m.group(4)),"title":(m.group(5) or "").strip(" -–—"),"folder_id":item["id"],"folder_name":item["name"],"ancestor_names":anc}
        if not ok:summary["obsolete_or_outside"].append(rec)
        else:by[rec["code"]].append(rec)
    dup={k:v for k,v in by.items() if len(v)!=1}
    if dup:raise RuntimeError("Duplicate active lesson codes: "+json.dumps({k:[x['folder_name'] for x in v] for k,v in dup.items()},sort_keys=True))
    lessons=[v[0] for v in by.values()]
    eng=sorted([x for x in lessons if x["subject_letter"]=="E"],key=lambda x:(x["term"],x["serial"]));math=sorted([x for x in lessons if x["subject_letter"]=="M"],key=lambda x:(x["term"],x["serial"]))
    if not eng or not math:raise RuntimeError("Did not discover both English and Maths")
    ordered=[]
    for i in range(max(len(eng),len(math))):
        if i<len(eng):ordered.append(eng[i])
        if i<len(math):ordered.append(math[i])
    r2=list_r2();all_expected=set()
    for l in ordered:
        code=l["code"];subject="english" if l["subject_letter"]=="E" else "maths";prefix=f"{subject}/year3/{code}/";scope=f"{subject}/year3/";files=walk(l["folder_id"]);accepted=[];excluded=[];keys=[]
        for x in files:
            if not exact_prefix(x["name"],code):excluded.append({"name":x["name"],"relative_path":x["relative_path"],"reason":"NON_CURRENT_CODE"});continue
            if ext(x["name"]) in POWERPOINT_EXTENSIONS:excluded.append({"name":x["name"],"relative_path":x["relative_path"],"reason":"POWERPOINT_OWNER_EXCLUDED"});continue
            if (x.get("mimeType") or "").startswith("application/vnd.google-apps."):raise RuntimeError(f"{code}: native Google Workspace current resource {x['name']}")
            key=prefix+classify(x["name"])+"/"+x["name"];keys.append(key);accepted.append({"id":x["id"],"name":x["name"],"relative_path":x["relative_path"],"size":x.get("size"),"mimeType":x.get("mimeType"),"key":key})
        if len(keys)!=len(set(keys)):raise RuntimeError(f"{code}: duplicate target path")
        expected=set(keys);all_expected|=expected
        candidates=sorted({(o.get("key") or "") for o in r2 if (o.get("key") or "").startswith(scope) and ((o.get("key") or "").startswith(prefix) or exact_prefix(PurePosixPath(o.get("key") or "").name,code)) and not (o.get("key") or "").endswith("/")})
        summary["lessons"].append({**l,"accepted_resources":accepted,"excluded_resources":excluded,"expected_keys":sorted(expected),"r2_candidate_keys_before":candidates,"r2_missing_expected_keys":sorted(expected-set(candidates)),"r2_excess_or_historical_candidate_keys":sorted(set(candidates)-expected)})
        print("STRUCTURE_PREFLIGHT",code,"FILES",len(files),"ACCEPTED",len(accepted),"EXCLUDED",len(excluded),"MISSING",len(expected-set(candidates)),"EXCESS",len(set(candidates)-expected),flush=True)
    scoped={(o.get("key") or "") for o in r2 if ((o.get("key") or "").startswith("english/year3/") or (o.get("key") or "").startswith("maths/year3/")) and (o.get("key") or "") and not (o.get("key") or "").endswith("/")}
    summary.update({"english_lesson_count":len(eng),"maths_lesson_count":len(math),"lesson_count":len(ordered),"accepted_resource_count":len(all_expected),"current_scoped_r2_file_count":len(scoped),"global_unsupported_year3_objects":sorted(scoped-all_expected),"global_unsupported_year3_object_count":len(scoped-all_expected),"powerpoint_excluded_count":sum(1 for l in summary["lessons"] for x in l["excluded_resources"] if x["reason"]=="POWERPOINT_OWNER_EXCLUDED"),"non_current_code_excluded_count":sum(1 for l in summary["lessons"] for x in l["excluded_resources"] if x["reason"]=="NON_CURRENT_CODE"),"status":"pass"})
    print("Y3_STRUCTURE_PREFLIGHT_PASS",flush=True)
except Exception as e:
    summary["status"]="fail";summary["error"]=f"{type(e).__name__}: {e}";print("Y3_STRUCTURE_PREFLIGHT_FAIL",summary["error"],flush=True);raise
finally:
    with open("y3-r2-structure-preflight-summary.json","w",encoding="utf-8") as f:json.dump(summary,f,indent=2,ensure_ascii=False,sort_keys=True);f.write("\n")
