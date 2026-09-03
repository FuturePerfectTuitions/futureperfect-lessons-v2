# FPT Portal V2 — Year 2 Drive-authoritative R2 reconciliation audit

Date: 2026-09-03
Branch: `ops/r2-drive-sync-y2`
Bucket: `fpt-materials-dev`
Successful full workflow run: `33794097129`

## Governing rules applied

- Google Drive is authoritative.
- Current Drive lesson code is the active R2 lesson-path ID.
- Only files whose filename begins with the exact current Drive lesson code are eligible current lesson resources.
- Owner clarification: PowerPoint-family files are excluded from Portal/R2.
- Exact Drive bytes were written afresh and each active R2 object was read back and checked by byte size and SHA-256.
- Historical, old-code, uncoded and unsupported Year 2 active R2 objects were removed after authoritative resources had verified.

## Completion summary

- Status: **PASS**
- Active Drive lessons discovered: **65** (29 English, 36 Maths)
- Lesson-level parity passes: **65 / 65**
- Accepted authoritative Drive resources: **157**
- Final active Year 2 R2 file objects: **157**
- PowerPoint resources excluded: **64**
- Non-current-code Drive files excluded: **24**
- Unsupported active Year 2 R2 objects removed in final cleanup: **24**
- Final global result: **`Y2_GLOBAL_EXACT_DRIVE_R2_PARITY_PASS`**

## Important EOS consequence of the exact-code rule

`Y2T3M35 EOS 1 2 3 4` and `Y2T3M36 EOS 5 6 7 8` each contain 12 Drive PDFs, but none of those filenames begins with the current lesson code. Under the governing exact-code rule, all 24 are exclusions and neither lesson has an active R2 resource object. The matching 24 old/uncoded R2 objects under historical `Y2M33` and `Y2M34` paths were removed. Drive itself was not changed.

## Lesson-by-lesson result

| Lesson | Authoritative Drive folder | Accepted | Excluded | R2 candidate deletions | Result |
|---|---|---:|---:|---:|---|
| `Y2T1E01` | Y2T1E01 Comprehension, Simple Present Simple Past | 2 | 1 | 0 | **PASS** |
| `Y2T1M01` | Y2T1M01 Transition to Year 2 | 3 | 1 | 0 | **PASS** |
| `Y2T1E02` | Y2T1E02 Tenses and Contractions | 2 | 1 | 2 | **PASS** |
| `Y2T1M02` | Y2T1M02 Money | 2 | 1 | 2 | **PASS** |
| `Y2T1E03` | Y2T1E03 Tenses, Adjectives, Grammar and Punctuation, Spelling | 2 | 2 | 2 | **PASS** |
| `Y2T1M03` | Y2T1M03 Money | 2 | 1 | 2 | **PASS** |
| `Y2T1E04` | Y2T1E04 Conjunctions | 2 | 1 | 2 | **PASS** |
| `Y2T1M04` | Y2T1M04 Multiplication and Division | 2 | 1 | 2 | **PASS** |
| `Y2T1E05` | Y2T1E05 Special Recap and Catchup Session for Conjunctions and Punctuations | 2 | 1 | 2 | **PASS** |
| `Y2T1M05` | Y2T1M05 Multiplication and Division | 2 | 1 | 2 | **PASS** |
| `Y2T1E06` | Y2T1E06 Expanded Nouns | 2 | 1 | 2 | **PASS** |
| `Y2T1M06` | Y2T1M06 Statistics | 2 | 1 | 2 | **PASS** |
| `Y2T1E07` | Y2T1E07 Compound Nouns and Commas in Lists | 2 | 1 | 2 | **PASS** |
| `Y2T1M07` | Y2T1M07 Statistics 2 | 3 | 1 | 3 | **PASS** |
| `Y2T1E08` | Y2T1E08 Suffixes | 2 | 1 | 2 | **PASS** |
| `Y2T1M08` | Y2T1M08 Statistics 3 | 3 | 1 | 3 | **PASS** |
| `Y2T1E09` | Y2T1E09 Comprehension & Progressive Tenses | 4 | 1 | 4 | **PASS** |
| `Y2T1M09` | Y2T1M09 Fractions | 2 | 1 | 2 | **PASS** |
| `Y2T1E10` | Y2T1E10 Comprehension & Tenses Game | 3 | 1 | 3 | **PASS** |
| `Y2T1M10` | Y2T1M10 Shapes | 2 | 1 | 2 | **PASS** |
| `Y2T2E11` | Y2T2E11 Tenses again | 2 | 1 | 2 | **PASS** |
| `Y2T1M11` | Y2T1M11 Measurements | 2 | 1 | 2 | **PASS** |
| `Y2T2E12` | Y2T2E12 Spelling, Comprehension & Punctuation | 3 | 1 | 3 | **PASS** |
| `Y2T1M12` | Y2T1M12 Time | 2 | 1 | 2 | **PASS** |
| `Y2T2E13` | Y2T2E13 Comprehension, Guided Reading, Writing, Inferencing | 3 | 1 | 3 | **PASS** |
| `Y2T2M13` | Y2T2M13 Position and Directions | 2 | 1 | 2 | **PASS** |
| `Y2T2E14` | Y2T2E14 Revision Activity | 2 | 1 | 2 | **PASS** |
| `Y2T2M14` | Y2T2M14 2 and 3 digit division | 3 | 1 | 3 | **PASS** |
| `Y2T2E15` | Y2T2E15 Revision Activity | 3 | 1 | 3 | **PASS** |
| `Y2T2M15` | Y2T2M15 Number and Place Value | 2 | 1 | 2 | **PASS** |
| `Y2T2E16` | Y2T2E16 Alliteration and Onomatopoeia | 2 | 1 | 2 | **PASS** |
| `Y2T2M16` | Y2T2M16 Additions and Subtractions | 2 | 1 | 2 | **PASS** |
| `Y2T2E17` | Y2T2E17 Apostrophes and Contractions | 3 | 1 | 3 | **PASS** |
| `Y2T2M17` | Y2T2M17 Partitioning | 2 | 1 | 2 | **PASS** |
| `Y2T2E18` | Y2T2E18 Sentence Structure | 2 | 1 | 2 | **PASS** |
| `Y2T2M18` | Y2T2M18 Word Problems | 2 | 1 | 2 | **PASS** |
| `Y2T2E19` | Y2T2E19 Adjectives with -er and -est | 2 | 1 | 2 | **PASS** |
| `Y2T2M19` | Y2T2M19 Polygons | 3 | 1 | 3 | **PASS** |
| `Y2T3E20` | Y2T3E20 Homophones | 2 | 1 | 2 | **PASS** |
| `Y2T2M20` | Y2T2M20 2D Shapes and Symmetry | 3 | 1 | 3 | **PASS** |
| `Y2T3E21` | Y2T3E21 Forming Adjectives -ful -less -ment | 3 | 1 | 3 | **PASS** |
| `Y2T2M21` | Y2T2M21 2D Shapes Sorting and Patterns | 3 | 1 | 3 | **PASS** |
| `Y2T3E22` | Y2T3E22 Questions and Commands | 3 | 1 | 3 | **PASS** |
| `Y2T2M22` | Y2T2M22 More 3D Shapes and Description | 3 | 1 | 3 | **PASS** |
| `Y2T3E23` | Y2T3E23 Spellings | 2 | 1 | 2 | **PASS** |
| `Y2T2M23` | Y2T2M23 Length and Height | 3 | 1 | 3 | **PASS** |
| `Y2T3E24` | Y2T3E24 Subordination | 3 | 1 | 3 | **PASS** |
| `Y2T2M24` | Y2T2M24 Length and Height 2 | 2 | 1 | 2 | **PASS** |
| `Y2T3E25` | Y2T3E25 Questions, Commands, Statements and Exclamations | 3 | 1 | 3 | **PASS** |
| `Y2T3M25` | Y2T3M25 Money 1 | 3 | 1 | 3 | **PASS** |
| `Y2T3E26` | Y2T3E26 Verbs | 3 | 1 | 3 | **PASS** |
| `Y2T3M26` | Y2T3M26 Money 2 | 3 | 1 | 3 | **PASS** |
| `Y2T3E27` | Y2T3E27 GAP Test 1 | 3 | 1 | 3 | **PASS** |
| `Y2T3M27` | Y2T3M27 Money 3 | 3 | 1 | 3 | **PASS** |
| `Y2T3E28` | Y2T3E28 GAP Test 2 | 3 | 1 | 3 | **PASS** |
| `Y2T3M28` | Y2T3M28 Length and Height 3 | 3 | 1 | 3 | **PASS** |
| `Y2T3E29` | Y2T3E29 Revision 1 | 2 | 1 | 2 | **PASS** |
| `Y2T3M29` | Y2T3M29 Mass 1 | 2 | 1 | 2 | **PASS** |
| `Y2T3M30` | Y2T3M30 Mass 2 | 3 | 1 | 3 | **PASS** |
| `Y2T3M31` | Y2T3M31 Mass 3 | 3 | 1 | 3 | **PASS** |
| `Y2T3M32` | Y2T3M32 Volume and Capacity 1 | 2 | 1 | 2 | **PASS** |
| `Y2T3M33` | Y2T3M33 Volume and Capacity 2 | 3 | 1 | 3 | **PASS** |
| `Y2T3M34` | Y2T3M34 Temperature | 3 | 1 | 3 | **PASS** |
| `Y2T3M35` | Y2T3M35 EOS 1 2 3 4 | 0 | 12 | 0 | **PASS** |
| `Y2T3M36` | Y2T3M36 EOS 5 6 7 8 | 0 | 12 | 0 | **PASS** |

## Final cleanup deletions

- `maths/year2/Y2M33/homework/answers/Answer Pack 1 Number and Place Value EOS.pdf`
- `maths/year2/Y2M33/homework/answers/Answer Pack 2 Addition and Subtraction EOS.pdf`
- `maths/year2/Y2M33/homework/answers/Answer Pack 3 Fractions EOS.pdf`
- `maths/year2/Y2M33/homework/answers/Answer Pack 4 Multiplication and Division EOS.pdf`
- `maths/year2/Y2M33/homework/answers/Answer Pack Assessment 1.pdf`
- `maths/year2/Y2M33/homework/answers/Answer Pack Assessment 2.pdf`
- `maths/year2/Y2M33/homework/sheets/1 Number and Place Value EOS.pdf`
- `maths/year2/Y2M33/homework/sheets/2 Addition and Subtraction EOS.pdf`
- `maths/year2/Y2M33/homework/sheets/3 Fractions EOS.pdf`
- `maths/year2/Y2M33/homework/sheets/4 Multiplication and Division EOS.pdf`
- `maths/year2/Y2M33/homework/sheets/Assessment 1.pdf`
- `maths/year2/Y2M33/homework/sheets/Assessment 2.pdf`
- `maths/year2/Y2M34/homework/answers/Answer Pack 5 Properties of Shapes EOS.pdf`
- `maths/year2/Y2M34/homework/answers/Answer Pack 6 Measurement EOS.pdf`
- `maths/year2/Y2M34/homework/answers/Answer Pack 7 Statistics EOS.pdf`
- `maths/year2/Y2M34/homework/answers/Answer Pack 8 Position and Direction EOS.pdf`
- `maths/year2/Y2M34/homework/answers/Answer Pack Assessment 3.pdf`
- `maths/year2/Y2M34/homework/answers/Answer Pack End of Year Activity Booklet.pdf`
- `maths/year2/Y2M34/homework/sheets/5 Properties of Shapes EOS.pdf`
- `maths/year2/Y2M34/homework/sheets/6 Measurement EOS.pdf`
- `maths/year2/Y2M34/homework/sheets/7 Statistics EOS.pdf`
- `maths/year2/Y2M34/homework/sheets/8 Position and Direction EOS.pdf`
- `maths/year2/Y2M34/homework/sheets/Assessment 3.pdf`
- `maths/year2/Y2M34/homework/sheets/End of Year Activity Booklet.pdf`

## Audit evidence

- Full machine-readable summary is preserved in the v1.3 Starter/Handover ZIP and GitHub Actions artifact `9909086093` (30-day Actions retention).
- Successful GitHub Actions run: `33794097129`.
- Every accepted resource record in the JSON includes Drive file ID, active R2 key, byte size and SHA-256.
- PowerPoint exclusions and non-current-code exclusions are recorded per lesson.

## Scope boundary

Only Year 2 English and Year 2 Maths R2 lesson-library objects were reconciled. KV, D1, Worker, Excel, DNS, login/auth and Drive were not modified.
