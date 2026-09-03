#!/usr/bin/env python3
import hashlib
import json
import os
import re
import runpy
import urllib.parse
from pathlib import Path

import requests

R2_BUCKET = "fpt-materials-dev"
MANAGED_ENGLISH_RE = re.compile(r"^english/year4/(?:Y4E\d+|Y4T[123]EE?\d{2})/", re.I)
MANAGED_MATHS_RE = re.compile(r"^maths/year4/(?:L1T[123]M\d{2}|Y4M\d+)/", re.I)

summary = {
    "status": "running",
    "mode": "YEAR4_DRIVE_AUTHORITATIVE_APPLY_FROM_CORRECTED_PREFLIGHT",
    "bucket": R2_BUCKET,
    "preflight_status": None,
    "expected_resource_count": 0,
    "managed_initial_keys": [],
    "managed_deleted_keys": [],
    "managed_final_keys": [],
    "protected_unmanaged_year4_count": 0,
    "protected_unmanaged_year4_unchanged": None,
    "error": None,
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def is_managed_year4_key(key: str) -> bool:
    return bool(MANAGED_ENGLISH_RE.match(key) or MANAGED_MATHS_RE.match(key))


def is_year4_key(key: str) -> bool:
    return key.startswith("english/year4/") or key.startswith("maths/year4/")


def clean_meta(obj):
    return {
        "size": obj.get("size"),
        "etag": obj.get("etag"),
        "uploaded": obj.get("uploaded"),
        "storageClass": obj.get("storageClass"),
    }


if os.environ.get("CONFIRM_YEAR4_APPLY") != "YES":
    raise RuntimeError("Year 4 mutation guard is not armed: set CONFIRM_YEAR4_APPLY=YES explicitly")

# Execute exactly the corrected read-only preflight first. The direct EE lesson folders were
# confirmed obsolete and removed from Drive by the owner; nested valid 11+/VR content remains
# governed by the current ordinary lesson folders.
source = Path("scripts/r2_drive_y4_full_preflight.py").read_text(encoding="utf-8")
old = '    if not ee_seen:\n        raise RuntimeError("No current Year 4 EE 11+ lesson folders discovered")\n'
if old not in source:
    raise RuntimeError("Expected obsolete EE requirement block not found; refusing to patch unknown preflight")
source = source.replace(
    old,
    '    # Separate EE lesson folders are obsolete and were removed from authoritative Drive.\n'
    '    # Nested valid 11+/VR resources remain governed by the current ordinary lesson folder.\n',
    1,
)
tmp_preflight = Path("/tmp/r2_drive_y4_corrected_preflight_for_apply.py")
tmp_preflight.write_text(source, encoding="utf-8")
ctx = runpy.run_path(str(tmp_preflight), run_name="__y4_corrected_preflight__")
preflight = ctx["summary"]
if preflight.get("status") != "pass":
    raise RuntimeError(f"Corrected Year 4 preflight did not pass: {preflight.get('error')}")
if preflight.get("ordinary_english_lesson_count") != 34 or preflight.get("maths_lesson_count") != 36:
    raise RuntimeError(
        "Corrected Year 4 lesson count mismatch: "
        f"english={preflight.get('ordinary_english_lesson_count')} maths={preflight.get('maths_lesson_count')}"
    )
if preflight.get("lesson_count") != 70:
    raise RuntimeError(f"Corrected Year 4 total lesson count is not 70: {preflight.get('lesson_count')}")
summary["preflight_status"] = "pass"
summary["preflight_counts"] = {
    "english_lessons": preflight.get("ordinary_english_lesson_count"),
    "maths_lessons": preflight.get("maths_lesson_count"),
    "expected_active_files": preflight.get("expected_active_file_count"),
    "powerpoint_excluded": preflight.get("powerpoint_excluded_count"),
    "non_current_outside_vr_excluded": preflight.get("non_current_code_excluded_count"),
    "vr_exception_accepted": preflight.get("vr_exception_accepted_count"),
}

expected = {rec["key"]: rec for rec in preflight.get("expected_resources") or []}
if len(expected) != preflight.get("expected_active_file_count"):
    raise RuntimeError("Preflight expected-resource list/count mismatch")
summary["expected_resource_count"] = len(expected)
expected_keys = set(expected)

drive = ctx["drive"]
list_all_r2 = ctx["list_all_r2"]

acct = os.environ["CLOUDFLARE_ACCOUNT_ID"]
token = os.environ["CLOUDFLARE_API_TOKEN"]
bucket = os.environ.get("R2_BUCKET", R2_BUCKET)
auth_headers = {"Authorization": f"Bearer {token}"}
r2_base = f"https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{bucket}/objects"


def r2_url(key: str) -> str:
    return r2_base + "/" + urllib.parse.quote(key, safe="/")


def get_r2(key: str) -> bytes:
    r = requests.get(r2_url(key), headers=auth_headers, timeout=300)
    if not r.ok:
        raise RuntimeError(f"R2 GET failed for {key}: HTTP {r.status_code} {r.text[:1000]}")
    return r.content


def put_r2(key: str, body: bytes, mime: str):
    r = requests.put(
        r2_url(key),
        headers={"Authorization": f"Bearer {token}", "Content-Type": mime},
        data=body,
        timeout=300,
    )
    if not r.ok:
        raise RuntimeError(f"R2 PUT failed for {key}: HTTP {r.status_code} {r.text[:1000]}")
    payload = r.json()
    if not payload.get("success"):
        raise RuntimeError(payload)


def delete_r2(key: str):
    r = requests.delete(r2_url(key), headers=auth_headers, timeout=180)
    if not r.ok:
        raise RuntimeError(f"R2 DELETE failed for {key}: HTTP {r.status_code} {r.text[:1000]}")
    payload = r.json()
    if not payload.get("success"):
        raise RuntimeError(payload)


def fresh_drive_body(rec):
    r = drive.get(
        f"https://www.googleapis.com/drive/v3/files/{rec['drive_id']}",
        params={"alt": "media", "supportsAllDrives": "true"},
        timeout=300,
    )
    if not r.ok:
        raise RuntimeError(f"Drive re-download failed for {rec['name']}: HTTP {r.status_code} {r.text[:600]}")
    body = r.content
    got_sha = sha256(body)
    if len(body) != rec["size"] or got_sha != rec["sha256"]:
        raise RuntimeError(
            f"Drive changed after preflight for {rec['name']}: "
            f"expected_size={rec['size']} got_size={len(body)} expected_sha={rec['sha256']} got_sha={got_sha}"
        )
    return body


def verify_all_expected():
    for key, rec in sorted(expected.items()):
        body = get_r2(key)
        got_sha = sha256(body)
        if len(body) != rec["size"] or got_sha != rec["sha256"]:
            raise RuntimeError(
                f"R2 verification failed for {key}: expected_size={rec['size']} got_size={len(body)} "
                f"expected_sha={rec['sha256']} got_sha={got_sha}"
            )


def main():
    initial = list_all_r2()
    initial_files = [o for o in initial if (o.get("key") or "") and not (o.get("key") or "").endswith("/")]
    managed_initial = sorted(o.get("key") or "" for o in initial_files if is_managed_year4_key(o.get("key") or ""))
    summary["managed_initial_keys"] = managed_initial
    protected_before = {
        o.get("key") or "": clean_meta(o)
        for o in initial_files
        if is_year4_key(o.get("key") or "") and not is_managed_year4_key(o.get("key") or "")
    }
    summary["protected_unmanaged_year4_count"] = len(protected_before)
    print("Y4_APPLY_EXPECTED_COUNT", len(expected), flush=True)
    print("Y4_MANAGED_INITIAL_COUNT", len(managed_initial), flush=True)
    print("Y4_PROTECTED_UNMANAGED_COUNT", len(protected_before), flush=True)

    # Write all authoritative current Drive resources. Every fresh Drive re-download must still
    # match the all-files preflight hash before it is PUT, and every PUT is read back and hashed.
    for idx, (key, rec) in enumerate(sorted(expected.items()), start=1):
        body = fresh_drive_body(rec)
        put_r2(key, body, rec.get("mime") or "application/octet-stream")
        readback = get_r2(key)
        if len(readback) != rec["size"] or sha256(readback) != rec["sha256"]:
            raise RuntimeError(f"Immediate R2 read-back mismatch for {key}")
        if idx % 25 == 0 or idx == len(expected):
            print("Y4_WRITE_VERIFY_PROGRESS", idx, "OF", len(expected), flush=True)

    # No deletion is permitted until every expected object passes a second full verification.
    verify_all_expected()
    print("Y4_ALL_EXPECTED_REVERIFIED_BEFORE_DELETE", flush=True)

    after_write = list_all_r2()
    managed_after_write = {
        o.get("key") or "" for o in after_write
        if (o.get("key") or "") and not (o.get("key") or "").endswith("/")
        and is_managed_year4_key(o.get("key") or "")
    }
    unsupported = sorted(managed_after_write - expected_keys)
    summary["unsupported_managed_count_before_delete"] = len(unsupported)
    for idx, key in enumerate(unsupported, start=1):
        delete_r2(key)
        summary["managed_deleted_keys"].append(key)
        if idx % 25 == 0 or idx == len(unsupported):
            print("Y4_DELETE_PROGRESS", idx, "OF", len(unsupported), flush=True)

    final = list_all_r2()
    final_files = [o for o in final if (o.get("key") or "") and not (o.get("key") or "").endswith("/")]
    managed_final = sorted({o.get("key") or "" for o in final_files if is_managed_year4_key(o.get("key") or "")})
    summary["managed_final_keys"] = managed_final
    if set(managed_final) != expected_keys:
        raise RuntimeError(
            f"Final Year 4 managed key mismatch missing={sorted(expected_keys-set(managed_final))} "
            f"extra={sorted(set(managed_final)-expected_keys)}"
        )
    verify_all_expected()

    protected_after = {
        o.get("key") or "": clean_meta(o)
        for o in final_files
        if is_year4_key(o.get("key") or "") and not is_managed_year4_key(o.get("key") or "")
    }
    if protected_after != protected_before:
        before_keys, after_keys = set(protected_before), set(protected_after)
        changed = sorted(k for k in before_keys & after_keys if protected_before[k] != protected_after[k])
        raise RuntimeError(
            "Protected Year 4 non-ordinary R2 objects changed during apply: "
            f"missing={sorted(before_keys-after_keys)} added={sorted(after_keys-before_keys)} changed={changed}"
        )
    summary["protected_unmanaged_year4_unchanged"] = True
    summary["final_active_file_count"] = len(managed_final)
    summary["status"] = "pass"
    print("Y4_GLOBAL_EXACT_DRIVE_R2_PARITY_PASS", len(managed_final), flush=True)


try:
    main()
except Exception as exc:
    summary["status"] = "fail"
    summary["error"] = f"{type(exc).__name__}: {exc}"
    print("Y4_RECONCILIATION_FAIL", summary["error"], flush=True)
    raise
finally:
    with open("y4-r2-reconciliation-summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")
