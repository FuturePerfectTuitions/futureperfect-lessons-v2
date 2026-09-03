#!/usr/bin/env python3
import hashlib
import json
import os
import re
import sys
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
LESSON_RE = re.compile(r"^(Y2T([123])([EM])(\d{2}))(?=$|[^A-Za-z0-9])(.*)$", re.IGNORECASE)
CURRENT_CODE_RE = re.compile(r"^Y2T[123][EM]\d{2}(?=$|[^A-Za-z0-9])", re.IGNORECASE)

summary = {
    "status": "running",
    "root_lessons_id": ROOT_LESSONS_ID,
    "bucket": R2_BUCKET,
    "powerpoints_excluded": True,
    "lessons_discovered": [],
    "obsolete_or_outside_candidates": [],
    "lessons": [],
    "global_cleanup_deleted": [],
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


def json_print(label, payload):
    print(label, json.dumps(payload, sort_keys=True, ensure_ascii=False), flush=True)


info = json.loads(os.environ["GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"])
creds = service_account.Credentials.from_service_account_info(
    info,
    scopes=["https://www.googleapis.com/auth/drive.readonly"],
)
drive = AuthorizedSession(creds)

acct = os.environ["CLOUDFLARE_ACCOUNT_ID"]
token = os.environ["CLOUDFLARE_API_TOKEN"]
bucket = os.environ.get("R2_BUCKET", R2_BUCKET)
auth_headers = {"Authorization": f"Bearer {token}"}
r2_base = f"https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{bucket}/objects"


def drive_query(q: str):
    page_token = None
    out = []
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
    """Return (inside_root, ancestor_names, ancestor_ids)."""
    names = []
    ids = []
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
            f"Native Google Workspace file encountered for current resource {item['name']!r}; "
            "cannot preserve exact stored bytes safely"
        )
    r = drive.get(
        f"https://www.googleapis.com/drive/v3/files/{item['id']}",
        params={"alt": "media", "supportsAllDrives": "true"},
        timeout=300,
    )
    if not r.ok:
        raise RuntimeError(
            f"Drive download failed for {item['name']}: HTTP {r.status_code} {r.text[:600]}"
        )
    body = r.content
    if item.get("size") is not None and int(item["size"]) != len(body):
        raise RuntimeError(
            f"Drive size mismatch for {item['name']}: metadata={item['size']} actual={len(body)}"
        )
    return body


def r2_object_url(key: str) -> str:
    return r2_base + "/" + urllib.parse.quote(key, safe="/")


def list_all_r2():
    cursor = None
    out = []
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


def put_r2(key: str, body: bytes, mime: str):
    r = requests.put(
        r2_object_url(key),
        headers={"Authorization": f"Bearer {token}", "Content-Type": mime},
        data=body,
        timeout=300,
    )
    if not r.ok:
        raise RuntimeError(f"R2 PUT failed for {key}: HTTP {r.status_code} {r.text[:1000]}")
    payload = r.json()
    if not payload.get("success"):
        raise RuntimeError(payload)


def get_r2(key: str) -> bytes:
    r = requests.get(r2_object_url(key), headers=auth_headers, timeout=300)
    r.raise_for_status()
    return r.content


def delete_r2(key: str):
    r = requests.delete(r2_object_url(key), headers=auth_headers, timeout=180)
    r.raise_for_status()
    payload = r.json()
    if not payload.get("success"):
        raise RuntimeError(payload)


def discover_lessons():
    candidates = drive_query("mimeType='application/vnd.google-apps.folder' and name contains 'Y2T' and trashed=false")
    by_code = defaultdict(list)
    for item in candidates:
        m = LESSON_RE.match(item.get("name") or "")
        if not m:
            continue
        code = m.group(1).upper()
        term = int(m.group(2))
        subject_letter = m.group(3).upper()
        serial = int(m.group(4))
        title = (m.group(5) or "").strip(" -–—")
        inside_root, ancestor_names, ancestor_ids = ancestry_to_root(item)
        obsolete = any((n or "").strip().lower() in OBSOLETE_ANCESTOR_NAMES for n in ancestor_names)
        rec = {
            "code": code,
            "term": term,
            "subject_letter": subject_letter,
            "serial": serial,
            "title": title,
            "folder_id": item["id"],
            "folder_name": item["name"],
            "ancestor_names": ancestor_names,
            "ancestor_ids": ancestor_ids,
        }
        if not inside_root or obsolete:
            summary["obsolete_or_outside_candidates"].append(rec)
            continue
        by_code[code].append(rec)

    duplicates = {code: vals for code, vals in by_code.items() if len(vals) != 1}
    if duplicates:
        raise RuntimeError(
            "Ambiguous duplicate active Drive lesson folders: " +
            json.dumps({k: [{"id": v["folder_id"], "name": v["folder_name"]} for v in vals] for k, vals in duplicates.items()}, sort_keys=True)
        )

    lessons = [vals[0] for vals in by_code.values()]
    if not lessons:
        raise RuntimeError("No active Year 2 lesson folders discovered under authoritative Lessons root")
    if not any(x["subject_letter"] == "E" for x in lessons) or not any(x["subject_letter"] == "M" for x in lessons):
        raise RuntimeError("Year 2 discovery did not find both English and Maths lesson folders")

    # Preserve each subject's chronological Drive lesson sequence, interleaving English then Maths.
    english = sorted((x for x in lessons if x["subject_letter"] == "E"), key=lambda x: (x["term"], x["serial"], x["code"]))
    maths = sorted((x for x in lessons if x["subject_letter"] == "M"), key=lambda x: (x["term"], x["serial"], x["code"]))
    ordered = []
    for i in range(max(len(english), len(maths))):
        if i < len(english):
            ordered.append(english[i])
        if i < len(maths):
            ordered.append(maths[i])

    summary["lessons_discovered"] = [
        {"code": x["code"], "title": x["title"], "folder_id": x["folder_id"], "folder_name": x["folder_name"]}
        for x in ordered
    ]
    print("DISCOVERED_ENGLISH_LESSONS", len(english), flush=True)
    print("DISCOVERED_MATHS_LESSONS", len(maths), flush=True)
    json_print("DISCOVERED_ORDER", [x["code"] for x in ordered])
    return ordered


def preflight_drive(lessons):
    """Validate all lesson structures before any R2 mutation."""
    preflight = {}
    for lesson in lessons:
        code = lesson["code"]
        files = walk_drive(lesson["folder_id"])
        accepted = []
        excluded = []
        for item in files:
            if not exact_code_prefix(item["name"], code):
                excluded.append({"name": item["name"], "id": item["id"], "relative_path": item["relative_path"], "reason": "NON_CURRENT_CODE"})
                continue
            if extension(item["name"]) in POWERPOINT_EXTENSIONS:
                excluded.append({"name": item["name"], "id": item["id"], "relative_path": item["relative_path"], "reason": "POWERPOINT_OWNER_EXCLUDED"})
                continue
            accepted.append(item)

        # Duplicate target names would overwrite each other; stop before any writes.
        targets = []
        for item in accepted:
            targets.append(classify(item["name"]) + "/" + item["name"])
        if len(targets) != len(set(targets)):
            raise RuntimeError(f"{code}: duplicate authoritative target filename/path detected")

        preflight[code] = {"files": files, "accepted": accepted, "excluded": excluded}
        print("PREFLIGHT", code, "FILES", len(files), "ACCEPTED", len(accepted), "EXCLUDED", len(excluded), flush=True)
        for ex in excluded:
            json_print("DRIVE_EXCLUDED " + code, ex)
    return preflight


def process_lesson(lesson, preflight, r2_snapshot, all_expected_keys):
    code = lesson["code"]
    subject = "english" if lesson["subject_letter"] == "E" else "maths"
    current_prefix = f"{subject}/year2/{code}/"
    accepted = preflight[code]["accepted"]
    excluded = preflight[code]["excluded"]

    result = {
        "code": code,
        "title": lesson["title"],
        "folder_name": lesson["folder_name"],
        "folder_id": lesson["folder_id"],
        "subject": subject,
        "accepted_resources": [],
        "excluded_resources": excluded,
        "deleted_candidate_keys": [],
        "final_keys": [],
        "status": "running",
    }
    summary["lessons"].append(result)
    print("LESSON_START", code, lesson["folder_name"], flush=True)

    authoritative = {}
    for item in sorted(accepted, key=lambda x: x["relative_path"].lower()):
        body = download_drive_bytes(item)
        key = current_prefix + classify(item["name"]) + "/" + item["name"]
        rec = {
            "key": key,
            "drive_id": item["id"],
            "name": item["name"],
            "size": len(body),
            "sha256": sha256(body),
            "mime": item.get("mimeType") or "application/octet-stream",
            "body": body,
        }
        authoritative[key] = rec
        result["accepted_resources"].append({k: v for k, v in rec.items() if k != "body"})
        json_print("DRIVE_AUTHORITATIVE " + code, {k: v for k, v in rec.items() if k != "body"})

    expected_keys = set(authoritative)
    all_expected_keys.update(expected_keys)

    # Candidate set: every current-prefix object plus any Year 2 same-subject object whose basename carries this exact current code.
    scope_prefix = f"{subject}/year2/"
    candidate_keys = sorted({
        (o.get("key") or "")
        for o in r2_snapshot
        if (o.get("key") or "").startswith(scope_prefix)
        and (
            (o.get("key") or "").startswith(current_prefix)
            or basename_code_match(o.get("key") or "", code)
        )
    })
    json_print("R2_CANDIDATES_BEFORE " + code, candidate_keys)

    # Always write authoritative Drive bytes afresh, then immediately read back and hash.
    for key, rec in sorted(authoritative.items()):
        put_r2(key, rec["body"], rec["mime"])
        body = get_r2(key)
        got_size = len(body)
        got_sha = sha256(body)
        if got_size != rec["size"] or got_sha != rec["sha256"]:
            raise RuntimeError(f"{code}: R2 read-back mismatch for {key}: size={got_size} sha256={got_sha}")
        json_print("VERIFY_R2_MATCH " + code, {"key": key, "size": got_size, "sha256": got_sha})

    # Remove historical placement and unsupported/excess current-code objects only after all authoritative objects verify.
    for key in candidate_keys:
        if key and key not in expected_keys:
            delete_r2(key)
            result["deleted_candidate_keys"].append(key)
            print("AUDIT_DELETE_CANDIDATE", code, key, flush=True)

    fresh = list_all_r2()
    remaining_candidates = sorted({
        (o.get("key") or "")
        for o in fresh
        if (o.get("key") or "").startswith(scope_prefix)
        and (
            (o.get("key") or "").startswith(current_prefix)
            or basename_code_match(o.get("key") or "", code)
        )
        and not (o.get("key") or "").endswith("/")
    })
    if set(remaining_candidates) != expected_keys:
        raise RuntimeError(
            f"{code}: parity failure after reconciliation. expected={sorted(expected_keys)} actual={remaining_candidates}"
        )

    for key, rec in sorted(authoritative.items()):
        body = get_r2(key)
        if len(body) != rec["size"] or sha256(body) != rec["sha256"]:
            raise RuntimeError(f"{code}: final R2 read-back mismatch for {key}")

    result["final_keys"] = remaining_candidates
    result["status"] = "pass"
    print(code + "_EXACT_DRIVE_R2_PARITY_PASS", flush=True)
    return fresh


def global_cleanup(all_expected_keys):
    """After all lessons pass, remove every unsupported non-marker Year 2 active object."""
    objects = list_all_r2()
    scoped = [
        o for o in objects
        if (o.get("key") or "").startswith("english/year2/")
        or (o.get("key") or "").startswith("maths/year2/")
    ]
    unsupported = sorted({
        (o.get("key") or "")
        for o in scoped
        if (o.get("key") or "")
        and not (o.get("key") or "").endswith("/")
        and (o.get("key") or "") not in all_expected_keys
    })
    print("GLOBAL_UNSUPPORTED_YEAR2_OBJECT_COUNT", len(unsupported), flush=True)
    for key in unsupported:
        delete_r2(key)
        summary["global_cleanup_deleted"].append(key)
        print("AUDIT_GLOBAL_DELETE_UNSUPPORTED", key, flush=True)

    final_objects = list_all_r2()
    final_scoped_files = sorted({
        (o.get("key") or "")
        for o in final_objects
        if (
            (o.get("key") or "").startswith("english/year2/")
            or (o.get("key") or "").startswith("maths/year2/")
        )
        and (o.get("key") or "")
        and not (o.get("key") or "").endswith("/")
    })
    if set(final_scoped_files) != all_expected_keys:
        missing = sorted(all_expected_keys - set(final_scoped_files))
        extra = sorted(set(final_scoped_files) - all_expected_keys)
        raise RuntimeError(f"Final Year 2 global parity failure. missing={missing} extra={extra}")

    # Final byte/hash verification of every authoritative active object.
    expected_resource_index = {}
    for lesson in summary["lessons"]:
        for rec in lesson["accepted_resources"]:
            expected_resource_index[rec["key"]] = rec
    for key in sorted(all_expected_keys):
        rec = expected_resource_index[key]
        body = get_r2(key)
        if len(body) != rec["size"] or sha256(body) != rec["sha256"]:
            raise RuntimeError(f"Final global byte verification failed for {key}")

    summary["final_active_file_count"] = len(final_scoped_files)
    summary["final_active_keys"] = final_scoped_files
    print("Y2_GLOBAL_EXACT_DRIVE_R2_PARITY_PASS", flush=True)


def main():
    lessons = discover_lessons()
    preflight = preflight_drive(lessons)
    r2_snapshot = list_all_r2()
    print("R2_INITIAL_TOTAL_OBJECT_COUNT", len(r2_snapshot), flush=True)
    all_expected_keys = set()

    # Sequentially process the authoritative English/Maths interleaved order.
    for lesson in lessons:
        r2_snapshot = process_lesson(lesson, preflight, r2_snapshot, all_expected_keys)

    global_cleanup(all_expected_keys)
    summary["status"] = "pass"


try:
    main()
except Exception as exc:
    summary["status"] = "failure"
    summary["error"] = f"{type(exc).__name__}: {exc}"
    print("RECONCILIATION_FAILURE", summary["error"], file=sys.stderr, flush=True)
    raise
finally:
    with open("y2-r2-reconciliation-summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, sort_keys=True)
