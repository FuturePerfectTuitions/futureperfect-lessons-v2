#!/usr/bin/env python3
import hashlib, json, os, re, runpy, urllib.parse
import requests

R2_BUCKET="fpt-materials-dev"
MANAGED_ENGLISH_RE=re.compile(r"^english/year5/(?:Y5E\d+|Y5T[123]EE?\d{2})/",re.I)
MANAGED_MATHS_RE=re.compile(r"^maths/year5/(?:L2T[123]M\d{2}|Y5M\d+)/",re.I)
summary={"status":"running","mode":"YEAR5_INDEPENDENT_FINAL_READ_ONLY_BYTE_HASH_AUDIT","bucket":R2_BUCKET,"error":None}
def sha256(b): return hashlib.sha256(b).hexdigest()
def is_managed(k): return bool(MANAGED_ENGLISH_RE.match(k) or MANAGED_MATHS_RE.match(k))
ctx=runpy.run_path("scripts/r2_drive_y5_full_preflight.py",run_name="__y5_final_preflight__")
p=ctx["summary"]
if p.get("status")!="pass": raise RuntimeError(f"Fresh Year 5 preflight failed: {p.get('error')}")
if p.get("ordinary_english_lesson_count")!=36 or p.get("maths_lesson_count")!=38 or p.get("lesson_count")!=74: raise RuntimeError("Fresh Year 5 lesson count mismatch")
expected={r["key"]:r for r in p.get("expected_resources") or []}; keys=set(expected); list_all_r2=ctx["list_all_r2"]
acct=os.environ["CLOUDFLARE_ACCOUNT_ID"]; token=os.environ["CLOUDFLARE_API_TOKEN"]; bucket=os.environ.get("R2_BUCKET",R2_BUCKET)
base=f"https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{bucket}/objects"; auth={"Authorization":f"Bearer {token}"}
def get(k):
    r=requests.get(base+"/"+urllib.parse.quote(k,safe="/"),headers=auth,timeout=300)
    if not r.ok: raise RuntimeError(f"R2 GET failed {k}: {r.status_code} {r.text[:800]}")
    return r.content

def main():
    objs=[o for o in list_all_r2() if (o.get("key") or "") and not (o.get("key") or "").endswith("/")]
    actual={o["key"] for o in objs if is_managed(o.get("key") or "")}; missing=sorted(keys-actual); extra=sorted(actual-keys)
    summary.update({"english_lesson_count":36,"maths_lesson_count":38,"lesson_count":74,"expected_active_file_count":len(keys),"actual_managed_file_count":len(actual),"missing_keys":missing,"extra_keys":extra,"powerpoint_excluded_count":p.get("powerpoint_excluded_count"),"non_current_code_excluded_count":p.get("non_current_code_excluded_count"),"vr_exception_accepted_count":p.get("vr_exception_accepted_count"),"verified":[]})
    if missing or extra: raise RuntimeError(f"Year 5 final key parity failed missing={missing} extra={extra}")
    for i,k in enumerate(sorted(expected),1):
        r=expected[k]; b=get(k); h=sha256(b)
        if len(b)!=r["size"] or h!=r["sha256"]: raise RuntimeError(f"Year 5 final byte mismatch {k}")
        summary["verified"].append({"key":k,"size":len(b),"sha256":h})
        if i%25==0 or i==len(expected): print("Y5_FINAL_VERIFY_PROGRESS",i,"OF",len(expected),flush=True)
    summary["verified_file_count"]=len(summary["verified"]); summary["status"]="pass"; print("Y5_INDEPENDENT_FINAL_EXACT_KEY_SIZE_SHA256_PASS",len(expected),flush=True)
try: main()
except Exception as e:
    summary["status"]="fail"; summary["error"]=f"{type(e).__name__}: {e}"; print("Y5_FINAL_VERIFY_FAIL",summary["error"],flush=True); raise
finally:
    with open("y5-final-read-only-byte-hash-audit.json","w",encoding="utf-8") as f: json.dump(summary,f,indent=2,ensure_ascii=False,sort_keys=True); f.write("\n")
