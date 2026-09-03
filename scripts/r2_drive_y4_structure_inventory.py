#!/usr/bin/env python3
import json, os, re
from collections import defaultdict
from pathlib import PurePosixPath
import requests
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

ROOT_LESSONS_ID = "1FG_SZKaf3BVqKMpt3eb_wHI4L4POUX-y"
R2_BUCKET = "fpt-materials-dev"
FOLDER_MIME = "application/vnd.google-apps.folder"
PPT = {".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".ppsm", ".pot", ".potx", ".potm", ".ppa", ".ppam", ".sldx", ".sldm"}
LESSON_RE = re.compile(r"^(Y4T([123])([EM])(\d{2}))(?=$|[^A-Za-z0-9])(.*)$", re.I)

def exact(name, code): return re.match(r"^"+re.escape(code)+r"(?=$|[^A-Za-z0-9])", name, re.I) is not None
def ext(name): return PurePosixPath(name.lower()).suffix
def vr_context(path):
    p=path.lower().replace("_"," ").replace("-"," ")
    parts=[x.strip() for x in p.split("/") if x.strip()]
    return any(x == "vr" or x.startswith("vr ") or "verbal reasoning" in x for x in parts)

info=json.loads(os.environ["GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"])
creds=service_account.Credentials.from_service_account_info(info,scopes=["https://www.googleapis.com/auth/drive.readonly"])
drive=AuthorizedSession(creds); cache={}

def dq(q):
    out=[]; token=None
    while True:
        p={"q":q,"fields":"nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,trashed)","pageSize":"1000","supportsAllDrives":"true","includeItemsFromAllDrives":"true"}
        if token:p["pageToken"]=token
        r=drive.get("https://www.googleapis.com/drive/v3/files",params=p,timeout=120); r.raise_for_status(); x=r.json(); out += x.get("files",[]); token=x.get("nextPageToken")
        if not token:return out

def md(fid):
    if fid in cache:return cache[fid]
    r=drive.get(f"https://www.googleapis.com/drive/v3/files/{fid}",params={"fields":"id,name,mimeType,size,parents,trashed","supportsAllDrives":"true"},timeout=120); r.raise_for_status(); cache[fid]=r.json(); return cache[fid]

def active(item):
    q=list(item.get("parents") or []); seen=set(); names=[]
    while q:
        p=q.pop(0)
        if p in seen:continue
        seen.add(p)
        if p==ROOT_LESSONS_ID:return not any(n.strip().lower()=="obsolete lessons" for n in names), names
        m=md(p); names.append(m.get("name") or ""); q += m.get("parents") or []
    return False,names

def children(fid): return dq(f"'{fid.replace(chr(39), chr(92)+chr(39))}' in parents and trashed=false")
def walk(fid,rel=""):
    out=[]
    for x in children(fid):
        if x.get("mimeType")==FOLDER_MIME: out += walk(x["id"],rel+x["name"]+"/")
        else:
            y=dict(x); y["relative_path"]=rel+x["name"]; out.append(y)
    return out

def list_r2():
    acct=os.environ["CLOUDFLARE_ACCOUNT_ID"]; token=os.environ["CLOUDFLARE_API_TOKEN"]
    base=f"https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{os.environ.get('R2_BUCKET',R2_BUCKET)}/objects"; h={"Authorization":f"Bearer {token}"}; out=[]; cursor=None
    while True:
        p={"per_page":"1000"}
        if cursor:p["cursor"]=cursor
        r=requests.get(base,headers=h,params=p,timeout=120); r.raise_for_status(); x=r.json()
        if not x.get("success"):raise RuntimeError(x)
        out += x.get("result") or []; ri=x.get("result_info") or {}; cursor=ri.get("cursor") if ri.get("is_truncated") else None
        if not cursor:return out

summary={"status":"running","mode":"READ_ONLY_Y4_STRUCTURE_INVENTORY","year":4,"lessons":[],"obsolete_or_outside":[],"error":None}
try:
    by=defaultdict(list)
    for item in dq("mimeType='application/vnd.google-apps.folder' and name contains 'Y4T' and trashed=false"):
        m=LESSON_RE.match(item.get("name") or "")
        if not m:continue
        ok,anc=active(item); rec={"code":m.group(1).upper(),"term":int(m.group(2)),"subject_letter":m.group(3).upper(),"serial":int(m.group(4)),"title":(m.group(5) or "").strip(" -–—"),"folder_id":item["id"],"folder_name":item["name"],"ancestor_names":anc}
        (by[rec["code"]] if ok else summary["obsolete_or_outside"]).append(rec) if ok else summary["obsolete_or_outside"].append(rec)
    dup={k:v for k,v in by.items() if len(v)!=1}
    if dup: raise RuntimeError("Duplicate active lesson codes: "+json.dumps({k:[x['folder_name'] for x in v] for k,v in dup.items()},sort_keys=True))
    lessons=[v[0] for v in by.values()]; eng=sorted([x for x in lessons if x["subject_letter"]=="E"],key=lambda x:(x["term"],x["serial"])); math=sorted([x for x in lessons if x["subject_letter"]=="M"],key=lambda x:(x["term"],x["serial"]))
    if not eng or not math: raise RuntimeError("Did not discover both Year 4 English and Maths")
    ordered=[]
    for i in range(max(len(eng),len(math))):
        if i<len(eng):ordered.append(eng[i])
        if i<len(math):ordered.append(math[i])
    for l in ordered:
        code=l["code"]; files=walk(l["folder_id"]); exact_current=[]; ppt=[]; vr_special=[]; noncurrent=[]
        for x in files:
            rec={"id":x["id"],"name":x["name"],"relative_path":x["relative_path"],"size":x.get("size"),"mimeType":x.get("mimeType")}
            if ext(x["name"]) in PPT: ppt.append(rec); continue
            if exact(x["name"],code): exact_current.append(rec); continue
            if l["subject_letter"]=="E" and vr_context(x["relative_path"]): vr_special.append(rec); continue
            noncurrent.append(rec)
        summary["lessons"].append({**l,"file_count":len(files),"exact_current_code_non_ppt":exact_current,"powerpoint_excluded":ppt,"vr_special_review_candidates":vr_special,"other_non_current_code":noncurrent})
        print("Y4_STRUCTURE",code,"FILES",len(files),"EXACT",len(exact_current),"PPT",len(ppt),"VR_SPECIAL",len(vr_special),"OTHER_NONCURRENT",len(noncurrent),flush=True)
        for x in vr_special: print("Y4_VR_SPECIAL",code,json.dumps(x,ensure_ascii=False,sort_keys=True),flush=True)
        for x in noncurrent: print("Y4_NONCURRENT",code,json.dumps(x,ensure_ascii=False,sort_keys=True),flush=True)
    r2=list_r2(); scoped=sorted((o.get("key") or "") for o in r2 if ((o.get("key") or "").startswith("english/year4/") or (o.get("key") or "").startswith("maths/year4/")) and (o.get("key") or "") and not (o.get("key") or "").endswith("/"))
    summary.update({"english_lesson_count":len(eng),"maths_lesson_count":len(math),"lesson_count":len(ordered),"drive_total_file_count":sum(x["file_count"] for x in summary["lessons"]),"exact_current_code_non_ppt_count":sum(len(x["exact_current_code_non_ppt"]) for x in summary["lessons"]),"powerpoint_excluded_count":sum(len(x["powerpoint_excluded"]) for x in summary["lessons"]),"vr_special_review_candidate_count":sum(len(x["vr_special_review_candidates"]) for x in summary["lessons"]),"other_non_current_code_count":sum(len(x["other_non_current_code"]) for x in summary["lessons"]),"current_scoped_r2_file_count":len(scoped),"current_scoped_r2_keys":scoped,"status":"pass"})
    print("Y4_STRUCTURE_INVENTORY_PASS",flush=True)
except Exception as e:
    summary["status"]="fail"; summary["error"]=f"{type(e).__name__}: {e}"; print("Y4_STRUCTURE_INVENTORY_FAIL",summary["error"],flush=True); raise
finally:
    with open("y4-r2-structure-inventory.json","w",encoding="utf-8") as f: json.dump(summary,f,indent=2,ensure_ascii=False,sort_keys=True); f.write("\n")
