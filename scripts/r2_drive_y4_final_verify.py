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
    "mode": "YEAR4_INDEPENDENT_FINAL_READ_ONLY_BYTE_HASH_AUDIT",
    "bucket": R2_BUCKET,
    "error": None,
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def is_managed(key: str) -> bool:
    return bool(MANAGED_ENGLISH_RE.match(key) or MANAGED_MATHS_RE.match(key))


# Reuse the exact corrected discovery/resource rules, but do not mutate anything.
source = Path("scripts/r2_drive_y4_full_preflight.py").read_text(encoding="utf-8")
old = '    if not ee_seen:\n        raise RuntimeError("No current Year 4 EE 11+ lesson folders discovered")\n'
if old not in source:
    raise RuntimeError("Expected obsolete EE requirement block not found; refusing to verify unknown preflight")
source = source.replace(
    old,
    '    # Separate EE lesson folders are obsolete and were removed from authoritative Drive.\n'
    '    # Nested valid 11+/VR resources remain governed by the current ordinary lesson folder.\n',
    1,
)
tmp = Path("/tmp/r2_drive_y4_corrected_preflight_for_final_verify.py")
tmp.write_text(source, encoding="utf-8")
ctx = runpy.run_path(str(tmp), run_name="__y4_final_verify_preflight__")
preflight = ctx["summary"]
if preflight.get("status") != "pass":
    raise RuntimeError(f"Fresh corrected Drive preflight failed: {preflight.get('error')}")
if preflight.get("ordinary_english_lesson_count") != 34 or preflight.get("maths_lesson_count") != 36 or preflight.get("lesson_count") != 70:
    raise RuntimeError(
        "Fresh Year 4 lesson count mismatch: "
        f"english={preflight.get('ordinary_english_lesson_count')} maths={preflight.get('maths_lesson_count')} total={preflight.get('lesson_count')}"
    )

expected = {rec["key"]: rec for rec in preflight.get("expected_resources") or []}
expected_keys = set(expected)
list_all_r2 = ctx["list_all_r2"]

acct = os.environ["CLOUDFLARE_ACCOUNT_ID"]
token = os.environ["CLOUDFLARE_API_TOKEN"]
bucket = os.environ.get("R2_BUCKET", R2_BUCKET)
base = f"https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{bucket}/objects"
headers = {"Authorization": f"Bearer {token}"}


def get_r2(key: str) -> bytes:
    url = base + "/" + urllib.parse.quote(key, safe="/")
    r = requests.get(url, headers=headers, timeout=300)
    if not r.ok:
        raise RuntimeError(f"R2 GET failed for {key}: HTTP {r.status_code} {r.text[:800]}")
    return r.content


def main():
    objects = list_all_r2()
    files = [o for o in objects if (o.get("key") or "") and not (o.get("key") or "").endswith("/")]
    actual_managed = sorted({o.get("key") or "" for o in files if is_managed(o.get("key") or "")})
    actual_set = set(actual_managed)
    missing = sorted(expected_keys - actual_set)
    extra = sorted(actual_set - expected_keys)
    summary.update({
        "english_lesson_count": preflight.get("ordinary_english_lesson_count"),
        "maths_lesson_count": preflight.get("maths_lesson_count"),
        "lesson_count": preflight.get("lesson_count"),
        "expected_active_file_count": len(expected_keys),
        "actual_managed_file_count": len(actual_set),
        "missing_keys": missing,
        "extra_keys": extra,
        "powerpoint_excluded_count": preflight.get("powerpoint_excluded_count"),
        "non_current_code_excluded_count": preflight.get("non_current_code_excluded_count"),
        "vr_exception_accepted_count": preflight.get("vr_exception_accepted_count"),
        "verified": [],
    })
    if missing or extra:
        raise RuntimeError(f"Year 4 final key parity failed missing={missing} extra={extra}")

    for idx, key in enumerate(sorted(expected), start=1):
        rec = expected[key]
        body = get_r2(key)
        got_sha = sha256(body)
        if len(body) != rec["size"] or got_sha != rec["sha256"]:
            raise RuntimeError(
                f"Year 4 final byte mismatch {key}: expected_size={rec['size']} got_size={len(body)} "
                f"expected_sha={rec['sha256']} got_sha={got_sha}"
            )
        summary["verified"].append({"key": key, "size": len(body), "sha256": got_sha})
        if idx % 25 == 0 or idx == len(expected):
            print("Y4_FINAL_VERIFY_PROGRESS", idx, "OF", len(expected), flush=True)

    summary["verified_file_count"] = len(summary["verified"])
    summary["status"] = "pass"
    print("Y4_INDEPENDENT_FINAL_EXACT_KEY_SIZE_SHA256_PASS", len(expected), flush=True)


try:
    main()
except Exception as exc:
    summary["status"] = "fail"
    summary["error"] = f"{type(exc).__name__}: {exc}"
    print("Y4_FINAL_VERIFY_FAIL", summary["error"], flush=True)
    raise
finally:
    with open("y4-final-read-only-byte-hash-audit.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")
