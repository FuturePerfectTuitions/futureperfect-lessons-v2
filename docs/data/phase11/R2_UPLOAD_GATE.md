# Phase 11 — guarded R2 upload gate

Status: **PASS — development R2 corpus uploaded and verified**

The cleaned Phase 11 production lesson-resource corpus has been uploaded to the isolated V2 development R2 bucket using the guarded local uploader. The original locked manifest was followed by one reviewed incremental correction discovered during catalogue cross-checking.

## Verified R2 corpus

- Target bucket: `fpt-materials-dev`
- Original locked upload: **1,646 PDFs**
- Reviewed incremental correction: **23 PDFs**
- Total verified Phase 11 objects: **1,669 PDFs**
- Unique destination R2 keys: **1,669**
- Protected answer objects: **742**
- Non-answer objects: **927**
- Explicit reviewed exclusions: **7**
- Remote collisions across both runs: **0**
- Upload failures across both runs: **0**

The original manifest SHA-256 remains:

`d2659de60318c957dee1c0e765af5221e190d73be968e859a42cef20f6e94f15`

The incremental correction manifest SHA-256 is:

`c02dc0bfb80563b4bcb2b350a320bceebc5e2f5d79f2e90cfd76a5a2dbc52244`

The incremental correction contains the 23 genuine PDFs discovered during the final catalogue cross-check: five VR question/answer pairs, nine Year 2 EOS question sheets, two additional 11+ English student resources, one Year 5 11+ Display Posters resource, and one Year 6 Revision Notes resource.

The corpus contains no Office/source answer files and no Games/Mysteries resources. Every student-facing answer PDF represented in the Phase 11 R2 corpus remains classified as protected.

## Guarded uploader verification

Both upload runs used the same safety model:

1. every local source path was verified before any network write;
2. every source file was required to be a PDF;
3. every local PDF was hashed before R2 access;
4. every destination was HEAD-checked before any PUT;
5. a different existing object would abort the run;
6. exact existing objects would be skipped;
7. an explicit final write confirmation was required;
8. uploaded objects were tagged with SHA-256 metadata and verified after PUT;
9. the uploader contained no delete operation and did not persist R2 credentials.

## Returned run evidence

Original run:

- manifest rows: **1,646**
- uploaded: **1,646**
- skipped exact existing: **0**
- failed: **0**
- completed: `2026-08-24T06:39:17.944389+00:00`

Incremental correction run:

- manifest rows: **23**
- uploaded: **23**
- skipped exact existing: **0**
- failed: **0**
- completed: `2026-08-24T06:50:36.624696+00:00`

## Phase 11 gate

The R2 population gate is now closed successfully. Catalogue/KV work may proceed against the exact 1,669-object development corpus.

This does **not** activate Phase 11 by itself. The normal V2 Worker entrypoint remains unchanged until the catalogue metadata, guarded LESSONS_KV apply and browser/API verification gates are complete.
