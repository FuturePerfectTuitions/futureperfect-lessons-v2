# FPT Portal V2 — Year 2 Drive-authoritative R2 reconciliation audit

Date: 2026-09-03
Branch: `ops/r2-drive-sync-y2`
Bucket: `fpt-materials-dev`

## Governing rule

Google Drive is authoritative. Current Drive lesson code is the active R2 lesson-path ID. Every accepted current Drive resource is written afresh to R2 and must pass byte-size and SHA-256 read-back verification before historical/unsupported active objects are removed.

## Y2T1E01 — Comprehension, Simple Present Simple Past

Drive folder ID: `1_i54WilYBi_dMIiCC-n51oF5fEVc3ADV`

Fresh recursive Drive inventory: 3 files.
Eligible exact-code resources: 3.
Excluded resources: 0.

### Authoritative resources and verified active R2 objects

1. `Y2T1E01 Answer Pack Homework Comprehension, Simple Present Simple Past.pdf`
   - Drive file ID: `1nZ_cL_qPT5ECetDf9yr3XZpGhOYPky5c`
   - Size: 64,208 bytes
   - SHA-256: `018221642603f3c602747209a4804cf529ba0369c565c1caf3439e76d583b5b7`
   - Active R2 key: `english/year2/Y2T1E01/homework/answers/Y2T1E01 Answer Pack Homework Comprehension, Simple Present Simple Past.pdf`
   - R2 read-back size/hash: exact match

2. `Y2T1E01 Homework Comprehension, Simple Present Simple Past.pdf`
   - Drive file ID: `16QfkzkAMT0y9tptm1WE_FwOV4AbSCiTO`
   - Size: 2,505,615 bytes
   - SHA-256: `64239f3df90524b521fa0c184f8bdffda73a465afea0b59ce628084c40b0535d`
   - Active R2 key: `english/year2/Y2T1E01/homework/sheets/Y2T1E01 Homework Comprehension, Simple Present Simple Past.pdf`
   - R2 read-back size/hash: exact match

3. `Y2T1E01 Comprehension, Simple Present Simple Past.pptx`
   - Drive file ID: `1IQK8DN5EEtm8O-HD0UmjGKuWL_94L_g5`
   - Size: 17,100,963 bytes
   - SHA-256: `f9dc5f5a627749426c785a806210ceeb7bc57d47da7780423f9de74b3185df1a`
   - Active R2 key: `english/year2/Y2T1E01/other/Y2T1E01 Comprehension, Simple Present Simple Past.pptx`
   - R2 read-back size/hash: exact match

### Historical active R2 objects removed after verification

- `english/year2/Y2E1/homework/answers/Y2T1E01 Answer Pack Homework Comprehension, Simple Present Simple Past.pdf`
- `english/year2/Y2E1/homework/sheets/Y2T1E01 Homework Comprehension, Simple Present Simple Past.pdf`

### Final verification

Final active current-ID key count under `english/year2/Y2T1E01/`: 3.
Historical `english/year2/Y2E1/` lesson objects remaining: 0.
Workflow run: `33791576170`.
Result: `Y2T1E01_EXACT_DRIVE_R2_PARITY_PASS`.

## Next lesson

`Y2T1M01 Transition to Year 2` — fresh Drive folder ID `1qCX92s-3bxATWY-l05Qs01C0ioMMy81A`.

Current blocker before mutation: the service account can list the current PPTX but Google Drive returns `cannotDownloadFile` for `Y2T1M01 Transition to Year 2.pptx` (file ID `1zEjCRKCLtyxYzdJENN93zPb90d-gEB7M`). The owner-authenticated Drive connection can download it, confirming the current file exists and is 18,762,755 bytes, but the GitHub service account cannot obtain those bytes while viewer download/copy is restricted. No Y2T1M01 R2 mutation should occur until all four current resources can be obtained through the reconciliation runner.
