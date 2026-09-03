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
POWERPOINT_EXTENSIONS = {
    ".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".ppsm",
    ".pot", ".potx", ".potm", ".ppa", ".ppam", ".sldx", ".sldm",
}
OBSOLETE_ANCESTOR_NAMES = {"obsolete lessons"}
LESSON_RE = re.compile(r"^(Y3T([123])([EM])(\d{2}))(?=$|[^A-Za-z0-9])(.*)$", re.IGNORECASE)

summary = {
    "status": "running",
    "mode": "READ_ONLY_PREFLIGHT",
    "year": 3,
    "root_lessons_id": ROOT_LESSONS_ID,
    "bucket": R2_BUCKET,
    "powerpoints_excluded": True,
    "lessons_discovered": [],
    "obsolete_or_outside_candidates": [],
    "lessons": [],
    "global_unsupported_year3_objects": [],
    "error": None,
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def exact_code_prefix(name: str, code: str) -> bool:
    return re.match(r"^" + re.escape(code) + r"(?=$|[^A-Za-z0-9])", name, re.IGNORECASE) is not None


def extension(name: str) -> str:
    return PurePosixPath(name.lower()).suffix


def classify(name: str) -> str:
    lower = name.lower()
    if "answer pack" in lower or "answer key" in lower:
        return "homework/answers"
    if "prelesson" in lower or "pre-lesson" in lower or "pre lesson" in lower:
        return "prelesson/sheets"
    if "homework" in lower:
        return "homework/sheets"
    return "other"


def basename_code_match(key: str, code: str) -> bool:
    return exact_code_prefix(PurePosixPath(key).name, code)


def jprint(label, payload):
    print(label, json.dumps(payload, sort_keys=True, ensure_ascii=False), flush=True)


info = json.loads(os.environ["GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"])
creds = service_account.Credentials.from_service_account_info(
    info, scopes=["https://www.googleapis.com/auth/drive.readonly"]
)
drive = AuthorizedSession(creds)

acct = os.environ["CLOUDFLARE_ACCOUNT_ID"]
token = os.environ["CLOUDFLARE_API_TOKEN"]
bucket = os.environ.get("R2_BUCKET", R2_BUCKET)
auth_headers = {"Authorization": f"Bearer {token}"}
r2_base = f"https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{bucket}/objects"


def drive_query(q: str):
    out, page_token = [], None
    while True:
        params = {
            "q": q,
            "fields": "nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,trashed)",
            "pageSize": "1000",
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        }
        if page_token:
            params["pageToken"] = page_token
        r = drive.get("https://www.googleapis.com/drive/v3/files", params=params, timeout=120)
        r.raise_for_status()
        payload = r.json()
        out.extend(payload.get("files", []))
        page_token = payload.get("nextPageToken")
        if not page_token:
            return out


metadata_cache = {}


def get_drive_metadata(file_id: str):
    if file_id in metadata_cache:
        return metadata_cache[file_id]
    r = drive.get(
        f"https://www.googleapis.com/drive/v3/files/{file_id}",
        params={
            "fields": "id,name,mimeType,size,modifiedTime,parents,trashed",
            "supportsAllDrives": "true",
        },
        timeout=120,
    )
    r.raise_for_status()
    meta = r.json()
    metadata_cache[file_id] = meta
    return meta


def ancestry_to_root(item):
    names, ids = [], []
    queue = list(item.get("parents") or [])
    seen = set()
    while queue:
        parent_id = queue.pop(0)
        if parent_id in seen:
            continue
        seen.add(parent_id)
        ids.append(parent_id)
        if parent_id == ROOT_LESSONS_ID:
            return True, names, ids
        meta = get_drive_metadata(parent_id)
        names.append(meta.get("name") or "")
        queue.extend(meta.get("parents") or [])
    return False, names, ids


def list_drive_children(folder_id: str):
    safe_id = folder_id.replace("'", "\\'")
    return drive_query(f"'{safe_id}' in parents and trashed=false")


def walk_drive(folder_id: str, rel: str = ""):
    files = []
    for item in list_drive_children(folder_id):
        if item.get("mimeType") == FOLDER_MIME:
            files.extend(walk_drive(item["id"], rel + item["name"] + "/"))
        else:
            rec = dict(item)
            rec["relative_path"] = rel + item["name"]
            files.append(rec)
    return files


def download_drive_bytes(item):
    if (item.get("mimeType") or "").startswith("application/vnd.google-apps."):
        raise RuntimeError(
            f"Native Google Workspace file encountered for current resource {item['name']!r}; exact stored bytes cannot be preserved safely"
        )
    r = drive.get(
        f"https://www.googleapis.com/drive/v3/files/{item['id']}",
        params={"alt": "media", "supportsAllDrives": "true"},
        timeout=300,
    )
    if not r.ok:
        raise RuntimeError(f"Drive download failed for {item['name']}: HTTP {r.status_code} {r.text[:600]}")
    body = r.content
    if item.get("size") is not None and int(item["size"]) != len(body):
        raise RuntimeError(f"Drive size mismatch for {item['name']}: metadata={item['size']} actual={len(body)}")
    return body


def list_all_r2():
    out, cursor = [], None
    while True:
        params = {"per_page": "1000"}
        if cursor:
            params["cursor"] = cursor
        r = requests.get(r2_base, headers=auth_headers, params=params, timeout=120)
        r.raise_for_status()
        payload = r.json()
        if not payload.get("success"):
            raise RuntimeError(payload)
        out.extend(payload.get("result") or [])
        info = payload.get("result_info") or {}
        cursor = info.get("cursor") if info.get("is_truncated") else None
        if not cursor:
            return out


def discover_lessons():
    candidates = drive_query("mimeType='application/vnd.google-apps.folder' and name contains 'Y3T' and trashed=false")
    by_code = defaultdict(list)
    for item in candidates:
        m = LESSON_RE.match(item.get("name") or "")
        if not m:
            continue
        code = m.group(1).upper()
        rec = {
            "code": code,
            "term": int(m.group(2)),
            "subject_letter": m.group(3).upper(),
            "serial": int(m.group(4)),
            "title": (m.group(5) or "").strip(" -–—"),
            "folder_id": item["id"],
            "folder_name": item["name"],
        }
        inside_root, ancestor_names, ancestor_ids = ancestry_to_root(item)
        rec["ancestor_names"] = ancestor_names
        rec["ancestor_ids"] = ancestor_ids
        obsolete = any((n or "").strip().lower() in OBSOLETE_ANCESTOR_NAMES for n in ancestor_names)
        if not inside_root or obsolete:
            summary["obsolete_or_outside_candidates"].append(rec)
            continue
        by_code[code].append(rec)

    duplicates = {code: vals for code, vals in by_code.items() if len(vals) != 1}
    if duplicates:
        raise RuntimeError("Ambiguous duplicate active Drive lesson folders: " + json.dumps({k: [v['folder_name'] for v in vals] for k, vals in duplicates.items()}, sort_keys=True))

    lessons = [vals[0] for vals in by_code.values()]
    if not lessons:
        raise RuntimeError("No active Year 3 lesson folders discovered under authoritative Lessons root")
    if not any(x["subject_letter"] == "E" for x in lessons) or not any(x["subject_letter"] == "M" for x in lessons):
        raise RuntimeError("Year 3 discovery did not find both English and Maths lesson folders")

    english = sorted((x for x in lessons if x["subject_letter"] == "E"), key=lambda x: (x["term"], x["serial"], x["code"]))
    maths = sorted((x for x in lessons if x["subject_letter"] == "M"), key=lambda x: (x["term"], x["serial"], x["code"]))
    ordered = []
    for i in range(max(len(english), len(maths))):
        if i < len(english): ordered.append(english[i])
        if i < len(maths): ordered.append(maths[i])

    summary["lessons_discovered"] = [
        {"code": x["code"], "title": x["title"], "folder_id": x["folder_id"], "folder_name": x["folder_name"]}
        for x in ordered
    ]
    summary["english_lesson_count"] = len(english)
    summary["maths_lesson_count"] = len(maths)
    print("DISCOVERED_ENGLISH_LESSONS", len(english), flush=True)
    print("DISCOVERED_MATHS_LESSONS", len(maths), flush=True)
    jprint("DISCOVERED_ORDER", [x["code"] for x in ordered])
    return ordered


def main():
    lessons = discover_lessons()
    r2_snapshot = list_all_r2()
    print("R2_TOTAL_OBJECT_COUNT", len(r2_snapshot), flush=True)
    all_expected_keys = set()

    for lesson in lessons:
        code = lesson["code"]
        subject = "english" if lesson["subject_letter"] == "E" else "maths"
        current_prefix = f"{subject}/year3/{code}/"
        scope_prefix = f"{subject}/year3/"
        files = walk_drive(lesson["folder_id"])
        accepted, excluded = [], []
        for item in files:
            if not exact_code_prefix(item["name"], code):
                excluded.append({"name": item["name"], "id": item["id"], "relative_path": item["relative_path"], "reason": "NON_CURRENT_CODE"})
                continue
            if extension(item["name"]) in POWERPOINT_EXTENSIONS:
                excluded.append({"name": item["name"], "id": item["id"], "relative_path": item["relative_path"], "reason": "POWERPOINT_OWNER_EXCLUDED"})
                continue
            accepted.append(item)

        authoritative = []
        target_keys = []
        for item in sorted(accepted, key=lambda x: x["relative_path"].lower()):
            body = download_drive_bytes(item)
            key = current_prefix + classify(item["name"]) + "/" + item["name"]
            target_keys.append(key)
            authoritative.append({
                "key": key,
                "drive_id": item["id"],
                "name": item["name"],
                "relative_path": item["relative_path"],
                "size": len(body),
                "sha256": sha256(body),
                "mime": item.get("mimeType") or "application/octet-stream",
            })
        if len(target_keys) != len(set(target_keys)):
            raise RuntimeError(f"{code}: duplicate authoritative target filename/path detected")

        expected = set(target_keys)
        all_expected_keys.update(expected)
        candidates = sorted({
            (o.get("key") or "") for o in r2_snapshot
            if (o.get("key") or "").startswith(scope_prefix)
            and ((o.get("key") or "").startswith(current_prefix) or basename_code_match(o.get("key") or "", code))
            and not (o.get("key") or "").endswith("/")
        })
        missing = sorted(expected - set(candidates))
        excess = sorted(set(candidates) - expected)

        rec = {
            "code": code,
            "title": lesson["title"],
            "folder_name": lesson["folder_name"],
            "folder_id": lesson["folder_id"],
            "subject": subject,
            "drive_file_count": len(files),
            "accepted_resources": authoritative,
            "excluded_resources": excluded,
            "r2_candidate_keys_before": candidates,
            "expected_keys": sorted(expected),
            "r2_missing_expected_keys": missing,
            "r2_excess_or_historical_candidate_keys": excess,
        }
        summary["lessons"].append(rec)
        print("PREFLIGHT", code, "FILES", len(files), "ACCEPTED", len(accepted), "EXCLUDED", len(excluded), "R2_MISSING", len(missing), "R2_EXCESS", len(excess), flush=True)
        for ex in excluded:
            jprint("DRIVE_EXCLUDED " + code, ex)
        for ar in authoritative:
            jprint("DRIVE_AUTHORITATIVE " + code, ar)
        jprint("R2_CANDIDATES_BEFORE " + code, candidates)

    scoped_files = sorted({
        (o.get("key") or "") for o in r2_snapshot
        if ((o.get("key") or "").startswith("english/year3/") or (o.get("key") or "").startswith("maths/year3/"))
        and (o.get("key") or "") and not (o.get("key") or "").endswith("/")
    })
    unsupported = sorted(set(scoped_files) - all_expected_keys)
    summary["global_unsupported_year3_objects"] = unsupported
    summary["expected_active_file_count"] = len(all_expected_keys)
    summary["current_scoped_r2_file_count"] = len(scoped_files)
    summary["global_unsupported_year3_object_count"] = len(unsupported)
    summary["accepted_resource_count"] = sum(len(x["accepted_resources"]) for x in summary["lessons"])
    summary["powerpoint_excluded_count"] = sum(1 for x in summary["lessons"] for r in x["excluded_resources"] if r["reason"] == "POWERPOINT_OWNER_EXCLUDED")
    summary["non_current_code_excluded_count"] = sum(1 for x in summary["lessons"] for r in x["excluded_resources"] if r["reason"] == "NON_CURRENT_CODE")
    summary["status"] = "pass"
    print("Y3_READ_ONLY_PREFLIGHT_PASS", flush=True)


try:
    main()
except Exception as exc:
    summary["status"] = "fail"
    summary["error"] = f"{type(exc).__name__}: {exc}"
    print("Y3_READ_ONLY_PREFLIGHT_FAIL", summary["error"], flush=True)
    raise
finally:
    with open("y3-r2-preflight-summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")
