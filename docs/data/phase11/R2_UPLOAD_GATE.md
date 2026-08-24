# Phase 11 — guarded R2 upload gate

Status: **manifest locked; upload not yet performed**

The cleaned Phase 11 resource corpus is now frozen into an exact local upload manifest for the isolated V2 development R2 bucket.

## Locked upload set

- Target bucket: `fpt-materials-dev`
- Upload objects: **1,646 PDFs**
- Unique destination R2 keys: **1,646**
- Protected answer objects: **737**
- Non-answer objects: **909**
- Explicit reviewed exclusions: **7**
- Manifest filename: `Phase11_R2_Upload_Manifest_FINAL.csv`
- Manifest SHA-256: `d2659de60318c957dee1c0e765af5221e190d73be968e859a42cef20f6e94f15`

The manifest contains no Office/source answer files and no Games/Mysteries resources. All student-facing Answer Packs represented in the upload set are PDFs and remain marked protected.

## Guarded local uploader

The FPT owner receives `Phase11_Guarded_R2_Upload_Package_FINAL.zip`. Its uploader is intentionally local because the production lesson PDFs live in the owner's Windows `Lessons` tree and are not stored in GitHub.

The uploader:

1. selects the local root `Lessons` folder;
2. verifies all 1,646 source paths and requires `.pdf` for every row;
3. hashes every local PDF before any R2 access;
4. connects only after local preflight passes;
5. HEAD-checks **every destination object before any PUT**;
6. aborts the whole write if a different object already exists at any destination;
7. skips an exact existing object;
8. asks for a final explicit upload confirmation;
9. writes `x-amz-meta-sha256` to uploaded objects and verifies every successful upload by HEAD;
10. writes a local run report for Phase 11 verification.

The uploader contains **no delete operation** and does not persist the R2 secret credentials.

## Phase 11 gate

No catalogue/KV apply may be treated as complete until a returned uploader report confirms:

- zero remote collisions;
- zero upload failures;
- all 1,646 manifest objects either uploaded and verified or skipped as exact existing objects.

Until that report exists, `r2WritePerformed` remains false and the normal V2 Worker entrypoint remains unchanged.
