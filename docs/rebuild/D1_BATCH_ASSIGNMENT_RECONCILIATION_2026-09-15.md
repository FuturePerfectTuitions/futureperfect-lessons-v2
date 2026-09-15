# D1 Student Batch Assignment Reconciliation — 2026-09-15

**Status: CLOSED — PASS (read-only audit)**

Audit branch: `audit/d1-batch-assignment-reconciliation-2026-09-15`  
Clean baseline: `4559416ca66c39b2523a2f41405533f2857356b8`  
Production mutation during this audit: **none**  
Workflow run: `34992902308` — SUCCESS  
Evidence artifact: `10405984246`  
Artifact digest: `sha256:3017092248ebd3dc9f172e445ee66c772cbd191fcaac7dac71b68cf28d5ebd4c`

## Authority and method

The independent roster authority is `FuturePerfectLive 2026-27 DATE_FORMAT_FIXED_V2 / Email Database`, source modified `2026-09-11T09:50:06Z`, with 25 current memberships across 16 real portal users.

Production was queried read-only for the complete `student_batch_assignments`, `batch_definitions`, `lesson_entitlements`, `online_prelesson_entitlements`, and `batch_lesson_releases` tables plus the current roster users' STUDENTS_KV profiles. Repository source was also scanned for every reference to `student_batch_assignments`.

The schema authority says assignment `effective_from` is inclusive and `effective_to` exclusive. It also explicitly states that batch/lesson mapping and batch membership do not themselves grant Student + Lesson entitlement.

## Exact production result

Production D1 currently contains **4 `student_batch_assignments` rows total**. All four exactly match the authoritative roster, including `effective_from`, and all are open/current:

| Portal ID | Batch | Effective from |
|---|---|---:|
| `kiaan1312` | `Y511FE` | 2026-09-12 |
| `kiaan1312` | `Y511FM` | 2026-09-08 |
| `yuug1210` | `Y3FE` | 2026-09-10 |
| `yuug1210` | `Y3FM` | 2026-09-07 |

There are **21 missing assignments**, **0 date/window mismatches**, **0 extra current assignments**, and **0 historical/stale assignment rows**.

Every one of the 21 missing rows satisfies all of the following independent checks:

- the membership exists in the authoritative live roster;
- the corresponding `batch_definitions` row exists;
- batch subject matches the roster subject;
- the batch is active as of 2026-09-15;
- the batch definition's `active_from` exactly equals the roster membership start date;
- the portal profile exists and is current;
- there is no competing D1 row for that same user/batch pair;
- adding the assignment would be additive only; no existing assignment needs rewriting or deletion.

Therefore all 21 are classified **`SAFE_TO_ADD_FROM_AUTHORITATIVE_ROSTER`**.

## Missing assignments classified safe to add

| Portal ID | Batch | Effective from | Subject | Existing entitlement corroboration |
|---|---|---:|---|---:|
| `aar1811` | `Y611FM` | 2026-09-12 | Maths | 1 |
| `aar1811` | `Y6FE` | 2026-09-10 | English | 1 |
| `abi3007` | `Y4FE` | 2026-09-11 | English | 1 |
| `ame0503` | `Y6FM` | 2026-09-08 | Maths | 1 |
| `ann3009` | `Y511OE1` | 2026-09-07 | English 11+ | 1 |
| `ann3009` | `Y511OM1` | 2026-09-09 | Maths 11+ | 1 |
| `ava2007` | `Y5FM` | 2026-09-09 | Maths | 1 |
| `ayla0108` | `Y411FE` | 2026-09-11 | English 11+ | 1 |
| `rei0710` | `Y411OM` | 2026-09-07 | Maths 11+ | 2 |
| `rei0710` | `Y411OE` | 2026-09-10 | English 11+ | 1 |
| `conn2209` | `Y6FM` | 2026-09-08 | Maths | 1 |
| `dha2806` | `Y411FM` | 2026-09-07 | Maths 11+ | 2 |
| `dha2806` | `Y411FE` | 2026-09-11 | English 11+ | 1 |
| `ma0605` | `Y511FM` | 2026-09-08 | Maths 11+ | 2 |
| `ma0605` | `Y511FE` | 2026-09-12 | English 11+ | 1 |
| `mahu1907` | `Y6FE` | 2026-09-10 | English | 0 |
| `mahu1907` | `Y6FM` | 2026-09-08 | Maths | 0 |
| `riaan1808` | `Y5OE` | 2026-09-11 | English | 1 |
| `meh0510` | `Y3FM` | 2026-09-07 | Maths | 2 |
| `meh0510` | `Y3FE` | 2026-09-10 | English | 1 |
| `zar0603` | `Y6OE` | 2026-09-07 | English | 1 plus 1 online-prelesson row |

`mahu1907` has no lesson-entitlement rows yet for either roster batch. This does not weaken the membership evidence: roster membership, batch configuration and current profile all agree, and assignment rows represent membership independently of whether a lesson has yet been released to that student.

## Runtime reachability

The rebuilt Student source tree has **0 direct references** to `student_batch_assignments`. Current public portal access therefore does not derive lesson/resource entitlement from this table.

The retained legacy Worker does still read assignments in its student-navigation layers. In particular, the legacy access code converts active assignment rows to current views and uses them for current/previous grouping and cross-subject preview calculation. The retained AdminOps compatibility harness also references its own compatibility assignment table. These are legacy/compatibility consumers, not the rebuilt Student hot path.

The current CSV lesson-release importer reads authoritative `batch_definitions` for batch/view and 11+ semantics; it does not require a `student_batch_assignments` row in order to grant the lesson entitlement.

## Repair decision

No D1 write was performed by this audit.

A follow-on repair can be tightly scoped to **21 additive INSERTs only**, using the exact roster portal ID, batch key and effective-from date. It should:

1. snapshot the four current rows before mutation;
2. abort if any of the 21 target pairs has appeared or changed since this audit;
3. insert only missing rows, with no UPDATE/DELETE;
4. verify D1 then contains exactly the 25 authoritative current memberships and no extras;
5. rerun the independent roster-backed entitlement audit and semantic entitlement audit;
6. verify the public Browser → Student topology and active Worker versions are unchanged;
7. retain a rollback SQL/evidence artifact, although rollback should only ever remove rows inserted by that exact repair run.

On current evidence, the 21-row additive repair is **safe and justified**, but it is a separate production mutation from this closed read-only audit.
