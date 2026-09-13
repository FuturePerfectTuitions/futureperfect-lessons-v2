# Checkpoint 8 — Backfill and Access Parity Audit

Status: **PASS — production read-only parity gate complete**

Date: 2026-09-13

## Scope

Checkpoint 8 compiles the rebuilt access/read models from the existing authoritative Portal V2 records and compares effective access rather than aggregate counts. The acceptance rule is zero unexplained access widening and zero unexplained access loss across every current student, every supported presentation catalogue, protected/ordinary lesson resources and special areas.

This checkpoint is audit/backfill work only. It does not deploy the new Student Worker, repoint production traffic, mutate pupil access, alter Cloudflare configuration or start Checkpoint 9.

## Important resource-parity correction made during the gate

An earlier Checkpoint 8 implementation compared the rebuild resource collector with an oracle that mirrored the same simplified top-level `preLessonSheets` / `homeworks` representation. That could falsely pass when a resource existed only in the authoritative Phase 11 extension model.

Before Checkpoint 8 was accepted, the gate was strengthened to cover the real production Phase 11 schema:

- `phase11Resources.core.preLessonPairs`
- `phase11Resources.core.cumulativeHomeworks`
- `phase11Resources.core.supplementaryAnswers`
- `phase11Resources.elevenPlus.preLessonPairs`
- `phase11Resources.elevenPlus.homeworks`
- `phase11Resources.elevenPlus.cumulativeHomeworks`
- `phase11Resources.elevenPlus.supplementaryAnswers`
- `phase11Resources.vr.supplementaryAnswers`

The rebuilt compiler now retains these extension resources, deduplicates resources already represented by the authoritative core fields, and carries presentation scope for extension-only 11+/VR resources. The Student Worker filters the same scope both when listing a lesson's resources and when resolving/opening a resource, so an 11+-only resource cannot become available from a normal Year presentation.

A separate legacy-resource oracle now derives the expected resource set directly from the authoritative record shape. It does not import the rebuild compiler or the Phase 11 rebuild normalizer. The synthetic gate deliberately removes an 11+-only presentation scope and proves that the independent oracle rejects the widened result.

## Synthetic acceptance coverage

`tests/rebuild-checkpoint8-backfill-access-parity.mjs` proves zero unexplained access differences for the required edge cases:

- late join;
- transfer;
- rejoin;
- previous/historical access;
- Full Library;
- blocked lesson override;
- PreLesson-only access;
- guest/manual grant;
- normal versus 11+ presentation;
- locked preview;
- SATs;
- cumulative Homework;
- protected Answer Packs.

`tests/rebuild-checkpoint8-phase11-resource-parity.mjs` additionally proves the authoritative Phase 11 shape, paired protected answers, core/11+ presentation separation, VR scope handling, deduplication and independent tamper detection.

## Production read-only gate

Workflow run `34778023402` executed against commit `1dff69742e041821eab08a2749745774ad070e9c` using read-only Cloudflare/D1/KV operations.

Final production-scale results:

- current student profiles audited: **23**;
- admin profiles excluded: **1**;
- inactive profiles excluded: **0**;
- supported presentation catalogues: **15**;
- authoritative curriculum buckets: **11**;
- canonical lessons audited: **372**;
- unexplained student access differences: **0**;
- special-area access mismatches: **0**;
- lesson resource mismatches: **0**;
- SATs lessons detected: **35**;
- cumulative-Homework lessons detected through the corrected Phase 11 model: **69**;
- lessons with protected Answer Packs: **363**;
- lessons containing Phase 11 extension data: **98**;
- Phase 11 extension entries: **125**.

Current production feature coverage observed in the 23 current profiles included:

- Full Library: **18** profiles;
- PreLesson-only: **2** profiles;
- manual lesson access: **7** profiles;
- configured preview/upsell views: **13** profiles;
- multiple batches: **2** profiles.

No current profile happened to exercise blocked lessons or a rejoin row at the 2026-09-13 snapshot. Those cases remain mandatory synthetic acceptance cases and passed the deterministic CP8 fixture.

## Regression gate

The final CP8 workflow also reran and passed:

- Checkpoint 6 — New Student Worker;
- Checkpoint 5 — Authentication and Capability Core;
- Checkpoint 4 — Dual-write Compatibility;
- Checkpoint 3 — Atomic Publishing;
- Checkpoint 2 — Prepared Read Models.

The Phase 11 parity test marker was `REBUILD_CHECKPOINT8_PHASE11_RESOURCE_PARITY_PASS` with independent tamper detection and explicit proof that an 11+-only resource is blocked from a normal Year view.

## Security conclusion

The Checkpoint 8 gate is satisfied: **zero unexplained access differences and zero resource/special-area parity mismatches** on the complete current production population and catalogue snapshot, with required absent-live edge cases covered synthetically.

Production remains on the existing legacy-authoritative/shadow state. No Student Worker cutover or production data mutation occurred in Checkpoint 8.

**Checkpoint 9 has not started.**
