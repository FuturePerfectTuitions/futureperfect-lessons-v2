#!/usr/bin/env python3
import hashlib
import json
import os
import re
from collections import defaultdict
from pathlib import PurePosixPath

import requests
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

ENGLISH_FOLDER_ID = "1OYFPtGBb9Io7dwiuIvdMYsvJnb2TczXb"
MATHS_FOLDER_ID = "1OzjeIf6BaFqEL8dCleM9ad3K-A1WtONw"
R2_BUCKET = "fpt-materials-dev"
FOLDER_MIME = "application/vnd.google-apps.folder"
POWERPOINT_EXTENSIONS = {
    ".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".ppsm",
    ".pot", ".potx", ".potm", ".ppa", ".ppam", ".sldx", ".sldm",
}

ORDINARY_ENGLISH_RE = re.compile(r"^(Y4T([123])E(\d{2}))(?=$|[^A-Za-z0-9])(.*)$", re.I)
EE_ENGLISH_RE = re.compile(r"^(Y4T([123])EE(\d{2}))(?=$|[^A-Za-z0-9])(.*)$", re.I)
MATHS_RE = re.compile(r"^(L1T([123])M(\d{2}))(?=$|[^A-Za-z0-9])(.*)$", re.I)
ORDINARY_RANGES = {1: range(1, 11), 2: range(11, 24), 3: range(24, 35)}
MATHS_RANGES = {1: range(1, 14), 2: range(14, 23), 3: range(23, 37)}

summary = {
    "status": "running",
    "mode": "READ_ONLY_YEAR4_FULL_EXPECTED_STATE_PREFLIGHT",
    "year": 4,
    "powerpoints_excluded": True,
    "exact_current_code_required_outside_vr": True,
    "vr_subtree_historical_code_exception": True,
    "drive_subject_folders": {"english": ENGLISH_FOLDER_ID, "maths": MATHS_FOLDER_ID},
    "lessons": [],
    "residual_direct_folders": [],
    "special_direct_folders": [],
    "error": None,
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def exact_code_prefix(name: str, code: str) -> bool:
    return re.match(r"^" + re.escape(code) + r"(?=$|[^A-Za-z0-9])", name, re.I) is not None


def extension(name: str) -> str:
    return PurePosixPath(name.lower()).suffix


def path_parts(relative_path: str):
    return [p.strip() for p in PurePosixPath(relative_path).parts[:-1]]


def is_vr_path(relative_path: str) -> bool:
    for p in path_parts(relative_path):
        q = re.sub(r"[-_]", " ", p.lower()).strip()
        if q == "vr" or q.startswith("vr ") or "verbal reasoning" in q:
            return True
    return False


def is_11plus_path(relative_path: str) -> bool:
    for p in path_parts(relative_path):
        q = p.lower().replace(" ", "")
        if "11+" in p.lower() or "11plus" in q:
            return True
    return False


def classify(relative_path: str, name: str, lesson_kind: str) -> str:
    lower = (relative_path + " " + name).lower()
    vr = is_vr_path(relative_path)
    is_11 = lesson_kind == "ee" or is_11plus_path(relative_path)
    prefix = "vr/" if vr else ("11plus/" if is_11 else "")

    answer = "answer pack" in lower or "answer key" in lower or "answerpack" in lower
    prelesson = (
        "prelesson" in lower or "pre-lesson" in lower or "pre lesson" in lower
        or bool(re.search(r"vrp\d", lower, re.I))
    )
    homework = "homework" in lower or bool(re.search(r"vrh\d", lower, re.I))

    if answer and prelesson:
        leaf = "prelesson/answers"
    elif answer:
        leaf = "homework/answers"
    elif prelesson:
        leaf = "prelesson/sheets"
    elif homework:
        leaf = "homework/sheets"
    else:
        leaf = "other"
    return prefix + leaf


info = json.loads(os.environ["GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"])
creds = service_account.Credentials.from_service_account_info(
    info,
    scopes=["https://www.googleapis.com/auth/drive.readonly"],
)
drive = AuthorizedSession(creds)


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


def children(folder_id: str):
    safe_id = folder_id.replace("'", "\\'")
    return drive_query(f"'{safe_id}' in parents and trashed=false")


def walk(folder_id: str, rel: str = ""):
    out = []
    for item in children(folder_id):
        if item.get("mimeType") == FOLDER_MIME:
            out.extend(walk(item["id"], rel + item["name"] + "/"))
        else:
            rec = dict(item)
            rec["relative_path"] = rel + item["name"]
            out.append(rec)
    return out


def download_drive_bytes(item):
    mime = item.get("mimeType") or ""
    if mime.startswith("application/vnd.google-apps."):
        raise RuntimeError(
            f"Native Google Workspace file encountered in accepted resource: {item['name']!r}"
        )
    r = drive.get(
        f"https://www.googleapis.com/drive/v3/files/{item['id']}",
        params={"alt": "media", "supportsAllDrives": "true"},
        timeout=300,
    )
    r.raise_for_status()
    body = r.content
    if item.get("size") is not None and int(item["size"]) != len(body):
        raise RuntimeError(
            f"Drive size mismatch for {item['name']}: metadata={item['size']} actual={len(body)}"
        )
    return body


def discover_lessons():
    english_direct = children(ENGLISH_FOLDER_ID)
    maths_direct = children(MATHS_FOLDER_ID)
    lessons = []

    ordinary_seen = set()
    ee_seen = set()
    for item in english_direct:
        if item.get("mimeType") != FOLDER_MIME:
            continue
        name = item.get("name") or ""
        m = EE_ENGLISH_RE.match(name)
        if m:
            code = m.group(1).upper()
            if code in ee_seen:
                raise RuntimeError(f"Duplicate current EE lesson code {code}")
            ee_seen.add(code)
            lessons.append({
                "code": code, "subject": "english", "kind": "ee", "term": int(m.group(2)),
                "serial": int(m.group(3)), "title": (m.group(4) or "").strip(" -–—"),
                "folder_id": item["id"], "folder_name": name,
            })
            continue
        m = ORDINARY_ENGLISH_RE.match(name)
        if m:
            term, serial = int(m.group(2)), int(m.group(3))
            code = m.group(1).upper()
            if serial not in ORDINARY_RANGES[term]:
                summary["residual_direct_folders"].append({
                    "subject": "english", "id": item["id"], "name": name,
                    "reason": "OUTSIDE_CONTIGUOUS_CURRENT_ORDINARY_ENGLISH_TERM_RANGE",
                })
                continue
            if code in ordinary_seen:
                raise RuntimeError(f"Duplicate current ordinary English lesson code {code}")
            ordinary_seen.add(code)
            lessons.append({
                "code": code, "subject": "english", "kind": "ordinary", "term": term,
                "serial": serial, "title": (m.group(4) or "").strip(" -–—"),
                "folder_id": item["id"], "folder_name": name,
            })
            continue
        # Direct folder begins Y4 but is not a selected current ordinary/EE lesson => residual or special.
        if re.match(r"^Y4", name, re.I):
            summary["residual_direct_folders"].append({
                "subject": "english", "id": item["id"], "name": name,
                "reason": "NON_CURRENT_OR_LEGACY_DIRECT_FOLDER",
            })
        else:
            summary["special_direct_folders"].append({
                "subject": "english", "id": item["id"], "name": name,
                "reason": "SPECIAL_OR_MANUAL_AREA_NOT_ORDINARY_LESSON",
            })

    maths_seen = set()
    for item in maths_direct:
        if item.get("mimeType") != FOLDER_MIME:
            continue
        name = item.get("name") or ""
        m = MATHS_RE.match(name)
        if m:
            term, serial = int(m.group(2)), int(m.group(3))
            code = m.group(1).upper()
            if serial not in MATHS_RANGES[term]:
                summary["residual_direct_folders"].append({
                    "subject": "maths", "id": item["id"], "name": name,
                    "reason": "OUTSIDE_CONTIGUOUS_CURRENT_MATHS_TERM_RANGE",
                })
                continue
            if code in maths_seen:
                raise RuntimeError(f"Duplicate current Maths lesson code {code}")
            maths_seen.add(code)
            lessons.append({
                "code": code, "subject": "maths", "kind": "ordinary", "term": term,
                "serial": serial, "title": (m.group(4) or "").strip(" -–—"),
                "folder_id": item["id"], "folder_name": name,
            })
            continue
        if re.match(r"^Y4|^L1T", name, re.I):
            summary["residual_direct_folders"].append({
                "subject": "maths", "id": item["id"], "name": name,
                "reason": "NON_CURRENT_OR_LEGACY_DIRECT_FOLDER",
            })
        else:
            summary["special_direct_folders"].append({
                "subject": "maths", "id": item["id"], "name": name,
                "reason": "SPECIAL_OR_MANUAL_AREA_NOT_ORDINARY_LESSON",
            })

    expected_ordinary = {
        f"Y4T{t}E{s:02d}" for t, vals in ORDINARY_RANGES.items() for s in vals
    }
    if ordinary_seen != expected_ordinary:
        raise RuntimeError(
            f"Ordinary English current-code set mismatch. missing={sorted(expected_ordinary-ordinary_seen)} "
            f"extra={sorted(ordinary_seen-expected_ordinary)}"
        )
    expected_maths = {
        f"L1T{t}M{s:02d}" for t, vals in MATHS_RANGES.items() for s in vals
    }
    if maths_seen != expected_maths:
        raise RuntimeError(
            f"Maths current-code set mismatch. missing={sorted(expected_maths-maths_seen)} "
            f"extra={sorted(maths_seen-expected_maths)}"
        )
    if not ee_seen:
        raise RuntimeError("No current Year 4 EE 11+ lesson folders discovered")

    lessons.sort(key=lambda x: (x["subject"], x["kind"], x["term"], x["serial"], x["code"]))
    summary["ordinary_english_lesson_count"] = len(ordinary_seen)
    summary["ee_11plus_lesson_count"] = len(ee_seen)
    summary["maths_lesson_count"] = len(maths_seen)
    summary["lesson_count"] = len(lessons)
    return lessons


def build_expected(lessons):
    expected = {}
    for lesson in lessons:
        code = lesson["code"]
        files = walk(lesson["folder_id"])
        accepted = []
        excluded = []
        for item in sorted(files, key=lambda x: x["relative_path"].lower()):
            rel = item["relative_path"]
            ppt = extension(item["name"]) in POWERPOINT_EXTENSIONS
            vr = is_vr_path(rel)
            if ppt:
                excluded.append({
                    "id": item["id"], "name": item["name"], "relative_path": rel,
                    "reason": "POWERPOINT_OWNER_EXCLUDED",
                })
                continue
            if not vr and not exact_code_prefix(item["name"], code):
                excluded.append({
                    "id": item["id"], "name": item["name"], "relative_path": rel,
                    "reason": "NON_CURRENT_CODE_OUTSIDE_VR",
                })
                continue
            body = download_drive_bytes(item)
            category = classify(rel, item["name"], lesson["kind"])
            key = f"{lesson['subject']}/year4/{code}/{category}/{item['name']}"
            if key in expected:
                raise RuntimeError(f"Duplicate authoritative Year 4 target key {key}")
            rec = {
                "key": key,
                "drive_id": item["id"],
                "name": item["name"],
                "relative_path": rel,
                "size": len(body),
                "sha256": sha256(body),
                "mime": item.get("mimeType") or "application/octet-stream",
                "accepted_via": "VR_SUBTREE_EXCEPTION" if vr and not exact_code_prefix(item["name"], code) else "CURRENT_CODE",
                "category": category,
            }
            expected[key] = rec
            accepted.append(rec)
        lrec = dict(lesson)
        lrec["drive_file_count"] = len(files)
        lrec["accepted_resources"] = accepted
        lrec["excluded_resources"] = excluded
        lrec["status"] = "preflight_pass"
        summary["lessons"].append(lrec)
        print(
            "Y4_PREFLIGHT_LESSON", code, lesson["kind"],
            "FILES", len(files), "ACCEPTED", len(accepted), "EXCLUDED", len(excluded),
            flush=True,
        )
    return expected


def list_all_r2():
    acct = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    token = os.environ["CLOUDFLARE_API_TOKEN"]
    bucket = os.environ.get("R2_BUCKET", R2_BUCKET)
    base = f"https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{bucket}/objects"
    headers = {"Authorization": f"Bearer {token}"}
    out = []
    cursor = None
    while True:
        params = {"per_page": "1000"}
        if cursor:
            params["cursor"] = cursor
        r = requests.get(base, headers=headers, params=params, timeout=120)
        r.raise_for_status()
        payload = r.json()
        if not payload.get("success"):
            raise RuntimeError(payload)
        out.extend(payload.get("result") or [])
        info = payload.get("result_info") or {}
        cursor = info.get("cursor") if info.get("is_truncated") else None
        if not cursor:
            return out


def main():
    lessons = discover_lessons()
    expected = build_expected(lessons)
    r2 = list_all_r2()
    scoped = sorted({
        (o.get("key") or "") for o in r2
        if ((o.get("key") or "").startswith("english/year4/") or (o.get("key") or "").startswith("maths/year4/"))
        and (o.get("key") or "") and not (o.get("key") or "").endswith("/")
    })
    expected_keys = set(expected)
    scoped_set = set(scoped)
    summary["expected_active_file_count"] = len(expected_keys)
    summary["current_scoped_r2_file_count"] = len(scoped_set)
    summary["already_present_expected_keys"] = sorted(expected_keys & scoped_set)
    summary["missing_expected_keys"] = sorted(expected_keys - scoped_set)
    summary["unsupported_current_scoped_r2_keys"] = sorted(scoped_set - expected_keys)
    summary["expected_active_keys"] = sorted(expected_keys)
    summary["expected_resources"] = [expected[k] for k in sorted(expected)]
    summary["powerpoint_excluded_count"] = sum(
        1 for l in summary["lessons"] for x in l["excluded_resources"]
        if x["reason"] == "POWERPOINT_OWNER_EXCLUDED"
    )
    summary["non_current_code_excluded_count"] = sum(
        1 for l in summary["lessons"] for x in l["excluded_resources"]
        if x["reason"] == "NON_CURRENT_CODE_OUTSIDE_VR"
    )
    summary["vr_exception_accepted_count"] = sum(
        1 for x in expected.values() if x["accepted_via"] == "VR_SUBTREE_EXCEPTION"
    )
    summary["status"] = "pass"
    print("Y4_EXPECTED_ACTIVE_FILE_COUNT", len(expected_keys), flush=True)
    print("Y4_CURRENT_SCOPED_R2_FILE_COUNT", len(scoped_set), flush=True)
    print("Y4_ALREADY_PRESENT_EXPECTED", len(expected_keys & scoped_set), flush=True)
    print("Y4_MISSING_EXPECTED", len(expected_keys - scoped_set), flush=True)
    print("Y4_UNSUPPORTED_CURRENT_SCOPED", len(scoped_set - expected_keys), flush=True)
    print("Y4_POWERPOINT_EXCLUDED", summary["powerpoint_excluded_count"], flush=True)
    print("Y4_NONCURRENT_OUTSIDE_VR_EXCLUDED", summary["non_current_code_excluded_count"], flush=True)
    print("Y4_VR_EXCEPTION_ACCEPTED", summary["vr_exception_accepted_count"], flush=True)
    print("Y4_FULL_READ_ONLY_PREFLIGHT_PASS", flush=True)


try:
    main()
except Exception as exc:
    summary["status"] = "fail"
    summary["error"] = f"{type(exc).__name__}: {exc}"
    print("Y4_FULL_READ_ONLY_PREFLIGHT_FAIL", summary["error"], flush=True)
    raise
finally:
    with open("y4-r2-full-read-only-preflight.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")
