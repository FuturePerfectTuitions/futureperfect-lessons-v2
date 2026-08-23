# Phase 11 resource-pairing resolution

Status: **RESOLVED — staging only**

The cleaned Phase 11 resource inventory has been reconciled into explicit sheet/answer relationships without deleting genuine resources or fabricating missing answers.

## Result

- Active PDF manifest rows after reviewed exclusions: **1,646**.
- Explicit reviewed exclusions: **7**.
- Active resource families: **852**.
- Resource families resolved: **852**.
- Primary sheet -> answer relationships: **660**.
- Genuine sheet-only resources retained: **241**.
- Additional genuine protected answer resources retained: **77**.
- Protected answer relations: **737**.
- Unprotected answer relations: **0**.
- Fabricated Answer Packs: **0**.

## Resolution rules

1. A family with exactly one sheet and one answer is a confirmed single pair.
2. A multi-resource family is paired only when the filenames provide explicit correspondence through VRH/VRP/source codes, numbered Homework/Assessment/Week/Part/Set markers, or a strong matching resource title.
3. A multi-resource automatic match must pass the conservative matching threshold. No low-confidence multi-resource match is accepted.
4. Cumulative Homework pairings are confirmed by the previously completed branded cumulative Answer Pack batch provenance. Their FAR source names intentionally differ from the new branded Answer Pack filenames.
5. A genuine sheet with no dedicated answer is retained as sheet-only. An Answer Pack is never invented merely to make the model symmetrical.
6. A genuine additional answer file that is not the primary answer for a sheet is retained as a **supplementary protected answer** rather than being discarded or forced into a false pair.
7. Every answer relationship is protected under the Phase 8 answer mechanism.
8. The seven PDFs in `resource_exclusions_staging.csv` are the only reviewed files excluded from the ordinary Phase 11 R2 upload set.
9. The Y4E36 classifier correction in `resource_reclassifications_staging.csv` moves the affected PreLesson Answer Pack from 11+ PreLesson to VR PreLesson; this removes the former orphan-answer artefact.

## Audit artefact

A full file-by-file local resolution table was produced during the Phase 11 reconciliation and validated so that every active sheet and every active answer is accounted for exactly once in the relationship model. The compact reviewed-multiple decision table and corrected manifest are retained as Phase 11 working artefacts for final canonical catalogue/R2 serialization.

This resolution does **not** upload any files, change LESSONS_KV, change D1, change student permissions, activate `index-phase11.js`, or alter the existing live portal.
