# Cumulative Homework catalogue-wide repair — 2026-09-08

Status: **LIVE PRODUCTION REPAIR VERIFIED — PASS**

## Trigger

A live student lesson (`Y6M2.2`, displayed as `L3T1M02 Number and Place Value II`) showed the protected Cumulative Homework Answer Pack under **Additional Answer Packs**, while the actual Cumulative Homework PDF was absent from the lesson page.

The expected physical pair already existed in `MATERIALS_R2`:

- Primary: `maths/level3/Y6M2.2/cumulative-homework/sheets/FAR300326Y6M2.2.pdf`
- Answer: `maths/level3/Y6M2.2/cumulative-homework/answers/L3T1M02 Answer Pack Cumulative Homework Number and Place Value II.pdf`

This was treated as a catalogue-wide classification/mapping issue rather than a one-lesson exception.

## Contract used

The existing Phase 11 resource model already supports explicit Cumulative Homework + protected Answer Pack pairs. Shared Level 1/2/3 Maths cumulative resources belong in `phase11Resources.elevenPlus.cumulativeHomeworks`; genuine normal-stream resources such as Year 6 Extra cumulative resources remain under `phase11Resources.core.cumulativeHomeworks`.

The historic pairing resolution also explicitly states that FAR source filenames can legitimately differ from the branded Cumulative Homework Answer Pack filenames and must still be paired by reviewed provenance.

No frontend or Worker capability change was required for this repair.

## Read-only live audit

Audit run: GitHub Actions run `34264513307`.

The audit read the production Worker's current `LESSONS_KV` and `MATERIALS_R2` bindings and inspected every live lesson record and every live R2 object.

### Live inventory before repair

- Live lesson records: **374**
- Live R2 objects: **2,042**
- Physical R2 Cumulative Homework folders with exactly one sheet + one answer: **111**
  - Level 1: **34**
  - Level 2: **36**
  - Level 3: **36**
  - Year 6 Extra: **5**
- Level 1/2/3 physical cumulative pairs: **106** (`34 + 36 + 36`)
- Existing live student-facing cumulative pair mappings: **7**
  - `Y4M24` — existing Level 1 / 11+ pair
  - `Y5M2` — existing core normal-year pair
  - `Y6M46`–`Y6M50` — five existing core Year 6 Extra pairs
- Existing cumulative pair entries whose answer existed but primary was missing: **0**
- Cumulative Answer Packs incorrectly classified as supplementary / **Additional Answer Packs**: **20**

All 106 Level 1/2/3 R2 cumulative folders matched a live lesson ID with the corresponding `maths-level1`, `maths-level2`, or `maths-level3` display identity.

## Repair applied

Repair run: GitHub Actions run `34265173836`.

A guarded production `LESSONS_KV` bulk write corrected all affected records together:

- Level 1/2/3 cumulative pairs required: **106**
- Already correct Level 1 pair (`Y4M24`): **1**
- Lesson records changed: **105** (`106 - 1`)
- Misplaced cumulative supplementary Answer Packs removed from supplementary arrays: **20**
- Existing core cumulative pairs preserved: **6** (`Y5M2` plus `Y6M46`–`Y6M50`)

For every affected Level 1/2/3 lesson, the exact existing R2 sheet and exact existing R2 Answer Pack were placed together in `phase11Resources.elevenPlus.cumulativeHomeworks`. No PDF was invented, renamed, moved, uploaded, or deleted.

A pre-write backup of all 105 changed live lesson records was captured before the bulk write.

The first immediate post-write read saw mixed old/new values because Cloudflare KV propagation was still in progress. No rollback or second write was performed. A separate delayed read-only verification was then run after propagation.

## Delayed production verification

Verification run: GitHub Actions run `34265603399`.

Result: **PASS** with no verification errors.

- Live lesson records checked: **374**
- Live R2 objects checked: **2,042**
- Physical R2 cumulative pairs: **111**
- Level 1 physical pairs: **34**
- Level 2 physical pairs: **36**
- Level 3 physical pairs: **36**
- Year 6 Extra physical pairs: **5**
- Level 1/2/3 targets verified against live lesson mappings: **106 / 106**
- Live `elevenPlus.cumulativeHomeworks` pairs: **106**
- Live `core.cumulativeHomeworks` pairs: **6**
- Total student-facing cumulative pairs: **112** (`106 + 6`)
- Cumulative Answer Packs remaining in supplementary / Additional Answer Packs: **0**
- Verification errors: **0**

### Original reported lesson verified

`Y6M2.2` now resolves to exactly this pair:

- Cumulative Homework: `maths/level3/Y6M2.2/cumulative-homework/sheets/FAR300326Y6M2.2.pdf`
- Protected Answer Pack: `maths/level3/Y6M2.2/cumulative-homework/answers/L3T1M02 Answer Pack Cumulative Homework Number and Place Value II.pdf`

Therefore the lesson data now feeds the dedicated **Cumulative Homework** renderer rather than exposing the Answer Pack as an **Additional Answer Pack**.

## Scope / safety

This repair changed only the affected production `LESSONS_KV` lesson records. It did **not** modify R2 objects, D1 student entitlements, student credentials, Answer Pack password rules, Worker code, frontend code, or curriculum navigation.

The one-time write workflow was removed after completion. A read-only live verifier is retained on the repair branch for repeat validation if required.

## Durable-source note

The historic compressed Phase 11 catalogue payload in the repository contains 369 lessons, while the current live catalogue contains 374 lessons and has subsequent production overlays/changes. It was therefore **not** rewritten as part of this production repair. Reapplying that historic payload wholesale would risk reverting later live catalogue changes. The live `LESSONS_KV` state is the verified repaired state documented here.
