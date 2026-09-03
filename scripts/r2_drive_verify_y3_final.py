#!/usr/bin/env python3
import hashlib
import json
import os
import re
import urllib.parse
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


def digest(b): return hashlib.sha256(b).hexdigest()
def exact(name, code): return re.match(r"^" + re.escape(code) + r"(?=$|[^A-Za-z0-9])", name, re.I) is not None
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
meta={}

def dq(q):
    out=[]; token=None
    while True:
        p={"q":q,"fields":"nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,trashed)","pageSize":"1000","supportsAllDrives":"true","includeItemsFromAllDrives":"true"}
        if token:p["pageToken"]=token
        r=drive.get("https://www.googleapis.com/drive/v3/files",params=p,timeout=120);r.raise_for_status();x=r.json();out+=x.get("files",[]);token=x.get("nextPageToken")
        if not token:return out

def md(fid):
    if fid in meta:return meta[fid]
    r=drive.get(f"https://www.googleapis.com/drive/v3/files/{fid}",params={"fields":"id,name,mimeType,size,parents,trashed","supportsAllDrives":"true"},timeout=120);r.raise_for_status();meta[fid]=r.json();return meta[fid]

def is_active(item):
    q=list(item.get("parents") or []);seen=set();names=[]
    while q:
        p=q.pop(0)
        if p in seen:continue
        seen.add(p)
        if p==ROOT_LESSONS_ID:return not any(n.strip().lower()=="obsolete lessons" for n in names)
        m=md(p);names.append(m.get("name") or "");q+=m.get("parents") or []
    return False

def children(fid): return dq(f"'{fid.replace(chr(39), chr(92)+chr(39))}' in parents and trashed=false")
def walk(fid,rel=""):
    out=[]
    for x in children(fid):
        if x.get("mimeType")==FOLDER_MIME:out+=walk(x["id"],rel+x["name"]+"/")
        else:
            y=dict(x);y["relative_path"]=rel+x["name"];out.append(y)
    return out

def drive_bytes(item):
    if (item.get("mimeType") or "").startswith("application/vnd.google-apps."):
        raise RuntimeError(f"Native Google Workspace current resource: {item['name']}")
    r=drive.get(f"https://www.googleapis.com/drive/v3/files/{item['id']}",params={"alt":"media","supportsAllDrives":"true"},timeout=300)
    if not r.ok:raise RuntimeError(f"Drive download failed {item['name']}: HTTP {r.status_code}")
    b=r.content
    if item.get("size") is not None and len(b)!=int(item["size"]):raise RuntimeError(f"Drive size mismatch {item['name']}")
    return b

acct=os.environ["CLOUDFLARE_ACCOUNT_ID"];token=os.environ["CLOUDFLARE_API_TOKEN"]
base=f"https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{os.environ.get('R2_BUCKET',R2_BUCKET)}/objects";headers={"Authorization":f"Bearer {token}"}
def objurl(k):return base+"/"+urllib.parse.quote(k,safe="/")
def list_r2():
    out=[];cursor=None
    while True:
        p={"per_page":"1000"}
        if cursor:p["cursor"]=cursor
        r=requests.get(base,headers=headers,params=p,timeout=120);r.raise_for_status();x=r.json()
        if not x.get("success"):raise RuntimeError(x)
        out+=x.get("result") or [];ri=x.get("result_info") or {};cursor=ri.get("cursor") if ri.get("is_truncated") else None
        if not cursor:return out

def get_r2(k):
    r=requests.get(objurl(k),headers=headers,timeout=300);r.raise_for_status();return r.content

summary={"status":"running","mode":"READ_ONLY_FINAL_BYTE_HASH_AUDIT","year":3,"lessons":[],"error":None}
try:
    by=defaultdict(list)
    for item in dq("mimeType='application/vnd.google-apps.folder' and name contains 'Y3T' and trashed=false"):
        m=LESSON_RE.match(item.get("name") or "")
        if not m or not is_active(item):continue
        by[m.group(1).upper()].append({"code":m.group(1).upper(),"term":int(m.group(2)),"subject_letter":m.group(3).upper(),"serial":int(m.group(4)),"title":(m.group(5) or "").strip(" -–—"),"folder_id":item["id"],"folder_name":item["name"]})
    dup={k:v for k,v in by.items() if len(v)!=1}
    if dup:raise RuntimeError("Duplicate active current lesson code(s): "+",".join(sorted(dup)))
    lessons=[v[0] for v in by.values()]
    eng=sorted([x for x in lessons if x["subject_letter"]=="E"],key=lambda x:(x["term"],x["serial"]));math=sorted([x for x in lessons if x["subject_letter"]=="M"],key=lambda x:(x["term"],x["serial"]))
    if not eng or not math:raise RuntimeError("Missing Year 3 English or Maths active folders")
    ordered=[]
    for i in range(max(len(eng),len(math))):
        if i<len(eng):ordered.append(eng[i])
        if i<len(math):ordered.append(math[i])

    expected={}
    ppt_excluded=0; noncurrent_excluded=0
    for l in ordered:
        code=l["code"];subject="english" if l["subject_letter"]=="E" else "maths";prefix=f"{subject}/year3/{code}/";resources=[]
        for x in walk(l["folder_id"]):
            if not exact(x["name"],code):noncurrent_excluded+=1;continue
            if ext(x["name"]) in POWERPOINT_EXTENSIONS:ppt_excluded+=1;continue
            b=drive_bytes(x);key=prefix+classify(x["name"])+"/"+x["name"]
            if key in expected:raise RuntimeError(f"Duplicate expected key {key}")
            rec={"key":key,"drive_id":x["id"],"name":x["name"],"size":len(b),"sha256":digest(b)};expected[key]=rec;resources.append(rec)
        summary["lessons"].append({**l,"resources":resources})
        print("DRIVE_HASHED",code,len(resources),flush=True)

    r2=list_r2();actual=sorted({(o.get("key") or "") for o in r2 if ((o.get("key") or "").startswith("english/year3/") or (o.get("key") or "").startswith("maths/year3/")) and (o.get("key") or "") and not (o.get("key") or "").endswith("/")})
    exp=set(expected);act=set(actual)
    missing=sorted(exp-act);extra=sorted(act-exp)
    if missing or extra:raise RuntimeError(f"Year 3 key parity failure missing={missing} extra={extra}")

    verified=[]
    for i,key in enumerate(sorted(expected),1):
        rec=expected[key];b=get_r2(key);s=len(b);h=digest(b)
        if s!=rec["size"] or h!=rec["sha256"]:raise RuntimeError(f"R2 byte/hash mismatch {key}: got size={s} sha256={h}")
        verified.append({"key":key,"size":s,"sha256":h})
        if i%10==0 or i==len(expected):print("R2_HASH_VERIFIED",i,"OF",len(expected),flush=True)

    summary.update({"english_lesson_count":len(eng),"maths_lesson_count":len(math),"lesson_count":len(ordered),"expected_active_file_count":len(expected),"final_active_file_count":len(actual),"powerpoint_excluded_count":ppt_excluded,"non_current_code_excluded_count":noncurrent_excluded,"missing_keys":[],"extra_keys":[],"verified_resources":verified,"status":"pass"})
    print("Y3_FINAL_READ_ONLY_EXACT_BYTE_HASH_PARITY_PASS",flush=True)
except Exception as e:
    summary["status"]="fail";summary["error"]=f"{type(e).__name__}: {e}";print("Y3_FINAL_READ_ONLY_AUDIT_FAIL",summary["error"],flush=True);raise
finally:
    with open("y3-final-read-only-byte-hash-audit.json","w",encoding="utf-8") as f:json.dump(summary,f,indent=2,ensure_ascii=False,sort_keys=True);f.write("\n")
