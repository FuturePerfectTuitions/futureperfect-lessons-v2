# FPT Portal V2 — Year 2 Drive-authoritative R2 reconciliation audit

Date: 2026-09-03
Branch: `ops/r2-drive-sync-y2`
Bucket: `fpt-materials-dev`

## Governing rules

- Google Drive is authoritative.
- Current Drive lesson code is the active R2 lesson-path ID.
- Every accepted current Drive resource is written afresh to R2 and must pass byte-size and SHA-256 read-back verification before historical/unsupported active objects are removed.
- Owner clarification on 2026-09-03: **PowerPoint resources are excluded from Portal/R2.** PowerPoint-family extensions are not accepted lesson resources in this reconciliation.
- Existing or accidentally added PowerPoint objects under an active lesson path are unsupported/excess and must be removed after the accepted resources for that lesson are verified.

## Y2T1E01 — Comprehension, Simple Present Simple Past

Drive folder ID: `1_i54WilYBi_dMIiCC-n51oF5fEVc3ADV`

Fresh recursive Drive inventory: 3 files.
Accepted current-code non-PowerPoint resources: 2.
Excluded resources: 1 PowerPoint.

### Authoritative resources and verified active R2 objects

1. `Y2T1E01 Answer Pack Homework Comprehension, Simple Present Simple Past.pdf`
   - Drive file ID: `1nZ_cL_qPT5ECetDf9yr3XZpGhOYPky5c`
   - Size: 64,208 bytes
   - SHA-256: `018221642603f3c602747209a4804cf529ba0369c565c1caf3439e76d583b5b7`
   - Active R2 key: `english/year2/Y2T1E01/homework/answers/Y2T1E01 Answer Pack Homework Comprehension, Simple Present Simple Past.pdf`
   - Final R2 read-back: exact size/hash match

2. `Y2T1E01 Homework Comprehension, Simple Present Simple Past.pdf`
   - Drive file ID: `16QfkzkAMT0y9tptm1WE_FwOV4AbSCiTO`
   - Size: 2,505,615 bytes
   - SHA-256: `64239f3df90524b521fa0c184f8bdffda73a465afea0b59ce628084c40b0535d`
   - Active R2 key: `english/year2/Y2T1E01/homework/sheets/Y2T1E01 Homework Comprehension, Simple Present Simple Past.pdf`
   - Final R2 read-back: exact size/hash match

### Excluded PowerPoint

- `Y2T1E01 Comprehension, Simple Present Simple Past.pptx`
- Drive file ID: `1IQK8DN5EEtm8O-HD0UmjGKuWL_94L_g5`
- Reason: `POWERPOINT_OWNER_EXCLUDED`
- The previously added R2 PowerPoint object was removed as unsupported/excess.

### Historical active R2 objects removed

The two historical `english/year2/Y2E1/` objects had already been removed after exact verification in the prior run. Final historical object count remains 0.

### Final verification

Final active key count under `english/year2/Y2T1E01/`: 2.
PowerPoint objects under the active lesson path: 0.
Historical `english/year2/Y2E1/` lesson objects remaining: 0.
Correction/reverification workflow run: `33792343212`.
Result: `Y2T1E01_EXACT_DRIVE_R2_PARITY_PASS`.

## Y2T1M01 — Transition to Year 2

Drive folder ID: `1qCX92s-3bxATWY-l05Qs01C0ioMMy81A`

Fresh recursive Drive inventory: 4 files.
Accepted current-code non-PowerPoint resources: 3.
Excluded resources: 1 PowerPoint.

### Authoritative resources and verified active R2 objects

1. `Y2T1M01 Answer Pack Homework Transition to Year 2.pdf`
   - Drive file ID: `17415fef6Wd9kPbE0KmSKw1q-lRhGWQ9f`
   - Size: 11,075 bytes
   - SHA-256: `959d117cd5a209d83f56497674dc57091f8d7f99cfc03b803e48eea4064b0550`
   - Active R2 key: `maths/year2/Y2T1M01/homework/answers/Y2T1M01 Answer Pack Homework Transition to Year 2.pdf`
   - Final R2 read-back: exact size/hash match

2. `Y2T1M01 Homework Transition to Year 2.pdf`
   - Drive file ID: `1TU_yhClwdvCtzPeu7Uiu56wiM3r8VpM5`
   - Size: 549,548 bytes
   - SHA-256: `2606cc94667b34eb97107c7034d6ee0cca3bbbfcc5707f8ed6cce96aa3de3c41`
   - Active R2 key: `maths/year2/Y2T1M01/homework/sheets/Y2T1M01 Homework Transition to Year 2.pdf`
   - Final R2 read-back: exact size/hash match

3. `Y2T1M01 PreLesson Sheets Transition to Year 2.pdf`
   - Drive file ID: `1mLCZfzhffhYRFaRrAtY39oeAkwdyGhMc`
   - Size: 745,725 bytes
   - SHA-256: `69f0e32fa73237c6e92eb17b31a349c980a4b562568901814f3997cc6628dc86`
   - Active R2 key: `maths/year2/Y2T1M01/prelesson/sheets/Y2T1M01 PreLesson Sheets Transition to Year 2.pdf`
   - Final R2 read-back: exact size/hash match

### Excluded PowerPoint

- `Y2T1M01 Transition to Year 2.pptx`
- Drive file ID: `1zEjCRKCLtyxYzdJENN93zPb90d-gEB7M`
- Reason: `POWERPOINT_OWNER_EXCLUDED`
- No PowerPoint was uploaded to R2.

### Historical active R2 objects removed after verification

- `maths/year2/Y2M1/homework/answers/Y2T1M01 Answer Pack Homework Transition to Year 2.pdf`
- `maths/year2/Y2M1/homework/sheets/Y2T1M01 Homework Transition to Year 2.pdf`
- `maths/year2/Y2M1/prelesson/sheets/Y2T1M01 PreLesson Sheets Transition to Year 2.pdf`

### Final verification

Final active key count under `maths/year2/Y2T1M01/`: 3.
PowerPoint objects under the active lesson path: 0.
Historical `maths/year2/Y2M1/` lesson objects remaining: 0.
Workflow run: `33792343212`.
Result: `Y2T1M01_EXACT_DRIVE_R2_PARITY_PASS`.

## Current boundary

The PowerPoint exclusion rule is now active for subsequent Year 2 reconciliation work. Continue sequentially from the next current English and Maths lessons, fresh-reading Drive before each mutation.
