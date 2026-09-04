#!/usr/bin/env python3
import hashlib, json, os, re, runpy, urllib.parse
import requests

R2_BUCKET="fpt-materials-dev"
MANAGED_ENGLISH_RE=re.compile(r"^english/year5/(?:Y5E\d+|Y5T[123]EE?\d{2})/",re.I)
MANAGED_MATHS_RE=re.compile(r"^maths/year5/(?:L2T[123]M\d{2}|Y5M\d+)/",re.I)
summary={"status":"running","mode":"YEAR5_DRIVE_AUTHORITATIVE_GUARDED_APPLY","bucket":R2_BUCKET,"error":None,"managed_initial_keys":[],"managed_deleted_keys":[],"managed_final_keys":[]}

def sha256(b): return hashlib.sha256(b).hexdigest()
def is_managed(k): return bool(MANAGED_ENGLISH_RE.match(k) or MANAGED_MATHS_RE.match(k))
def is_year5(k): return k.startswith("english/year5/") or k.startswith("maths/year5/")
def clean_meta(o): return {x:o.get(x) for x in ("size","etag","uploaded","storageClass")}

if os.environ.get("CONFIRM_YEAR5_APPLY")!="YES": raise RuntimeError("Year 5 mutation guard is not armed")
ctx=runpy.run_path("scripts/r2_drive_y5_full_preflight.py",run_name="__y5_apply_preflight__")
p=ctx["summary"]
if p.get("status")!="pass": raise RuntimeError(f"Year 5 preflight failed: {p.get('error')}")
if p.get("ordinary_english_lesson_count")!=36 or p.get("maths_lesson_count")!=38 or p.get("lesson_count")!=74:
    raise RuntimeError(f"Year 5 lesson count mismatch english={p.get('ordinary_english_lesson_count')} maths={p.get('maths_lesson_count')} total={p.get('lesson_count')}")
expected={r["key"]:r for r in p.get("expected_resources") or []}; expected_keys=set(expected)
if len(expected)!=p.get("expected_active_file_count"): raise RuntimeError("Year 5 expected list/count mismatch")
summary["preflight_counts"]={"english_lessons":36,"maths_lessons":38,"expected_active_files":len(expected),"powerpoint_excluded":p.get("powerpoint_excluded_count"),"non_current_outside_vr_excluded":p.get("non_current_code_excluded_count"),"vr_exception_accepted":p.get("vr_exception_accepted_count")}
list_all_r2=ctx["list_all_r2"]; drive=ctx["drive"]
acct=os.environ["CLOUDFLARE_ACCOUNT_ID"]; token=os.environ["CLOUDFLARE_API_TOKEN"]; bucket=os.environ.get("R2_BUCKET",R2_BUCKET)
base=f"https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{bucket}/objects"; auth={"Authorization":f"Bearer {token}"}
def url(k): return base+"/"+urllib.parse.quote(k,safe="/")
def get(k):
    r=requests.get(url(k),headers=auth,timeout=300)
    if not r.ok: raise RuntimeError(f"R2 GET failed {k}: {r.status_code} {r.text[:800]}")
    return r.content
def put(k,b,m):
    r=requests.put(url(k),headers={"Authorization":f"Bearer {token}","Content-Type":m},data=b,timeout=300)
    if not r.ok: raise RuntimeError(f"R2 PUT failed {k}: {r.status_code} {r.text[:800]}")
    j=r.json()
    if not j.get("success"): raise RuntimeError(j)
def delete(k):
    r=requests.delete(url(k),headers=auth,timeout=180)
    if not r.ok: raise RuntimeError(f"R2 DELETE failed {k}: {r.status_code} {r.text[:800]}")
    j=r.json()
    if not j.get("success"): raise RuntimeError(j)
def fresh_drive(rec):
    r=drive.get(f"https://www.googleapis.com/drive/v3/files/{rec['drive_id']}",params={"alt":"media","supportsAllDrives":"true"},timeout=300)
    if not r.ok: raise RuntimeError(f"Drive re-download failed {rec['name']}: {r.status_code}")
    b=r.content
    if len(b)!=rec["size"] or sha256(b)!=rec["sha256"]: raise RuntimeError(f"Drive changed after preflight: {rec['name']}")
    return b
def verify_all():
    for k,r in sorted(expected.items()):
        b=get(k)
        if len(b)!=r["size"] or sha256(b)!=r["sha256"]: raise RuntimeError(f"R2 byte/hash mismatch {k}")

def main():
    initial=[o for o in list_all_r2() if (o.get("key") or "") and not (o.get("key") or "").endswith("/")]
    managed=sorted(o["key"] for o in initial if is_managed(o.get("key") or "")); summary["managed_initial_keys"]=managed
    protected_before={o["key"]:clean_meta(o) for o in initial if is_year5(o.get("key") or "") and not is_managed(o.get("key") or "")}
    summary["protected_unmanaged_year5_count"]=len(protected_before)
    print("Y5_APPLY_EXPECTED_COUNT",len(expected),flush=True); print("Y5_MANAGED_INITIAL_COUNT",len(managed),flush=True); print("Y5_PROTECTED_UNMANAGED_COUNT",len(protected_before),flush=True)
    for i,(k,r) in enumerate(sorted(expected.items()),1):
        b=fresh_drive(r); put(k,b,r.get("mime") or "application/octet-stream"); rb=get(k)
        if len(rb)!=r["size"] or sha256(rb)!=r["sha256"]: raise RuntimeError(f"Immediate R2 read-back mismatch {k}")
        if i%25==0 or i==len(expected): print("Y5_WRITE_VERIFY_PROGRESS",i,"OF",len(expected),flush=True)
    verify_all(); print("Y5_ALL_EXPECTED_REVERIFIED_BEFORE_DELETE",flush=True)
    after=[o for o in list_all_r2() if (o.get("key") or "") and not (o.get("key") or "").endswith("/")]
    managed_after={o["key"] for o in after if is_managed(o.get("key") or "")}
    unsupported=sorted(managed_after-expected_keys); summary["unsupported_managed_count_before_delete"]=len(unsupported)
    for i,k in enumerate(unsupported,1):
        delete(k); summary["managed_deleted_keys"].append(k)
        if i%25==0 or i==len(unsupported): print("Y5_DELETE_PROGRESS",i,"OF",len(unsupported),flush=True)
    final=[o for o in list_all_r2() if (o.get("key") or "") and not (o.get("key") or "").endswith("/")]
    managed_final=sorted({o["key"] for o in final if is_managed(o.get("key") or "")}); summary["managed_final_keys"]=managed_final
    if set(managed_final)!=expected_keys: raise RuntimeError(f"Final Year 5 managed key mismatch missing={sorted(expected_keys-set(managed_final))} extra={sorted(set(managed_final)-expected_keys)}")
    verify_all()
    protected_after={o["key"]:clean_meta(o) for o in final if is_year5(o.get("key") or "") and not is_managed(o.get("key") or "")}
    if protected_after!=protected_before: raise RuntimeError("Protected Year 5 non-ordinary R2 objects changed during apply")
    summary["protected_unmanaged_year5_unchanged"]=True; summary["final_active_file_count"]=len(managed_final); summary["status"]="pass"
    print("Y5_GLOBAL_EXACT_DRIVE_R2_PARITY_PASS",len(managed_final),flush=True)
try: main()
except Exception as e:
    summary["status"]="fail"; summary["error"]=f"{type(e).__name__}: {e}"; print("Y5_RECONCILIATION_FAIL",summary["error"],flush=True); raise
finally:
    with open("y5-r2-reconciliation-summary.json","w",encoding="utf-8") as f: json.dump(summary,f,indent=2,ensure_ascii=False,sort_keys=True); f.write("\n")
