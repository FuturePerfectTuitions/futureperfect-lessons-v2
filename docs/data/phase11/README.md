# Phase 11 canonical catalogue staging

Status: **STAGING ONLY — NOT A PRODUCTION APPLY**

This directory reconciles the cleaned Phase 11 resource inventory with the current read-only legacy Lessons KV audit and the V2 canonical curriculum rules.

## What is locked in this staging set

- 369 canonical ordinary lessons across 11 canonical curriculum keys.
- Shared Maths is deduplicated: Year 4/Level 1, Year 5/Level 2 and Year 6 core/Level 3 use one canonical lesson record per underlying lesson.
- English Year 4 and Year 5 normal/11+ use one core canonical lesson identity; 11+ supplementary/VR resources remain components, not duplicate core entitlements.
- Current source-folder codes are retained separately from canonical/internal Lesson IDs.
- Proposed R2 target keys use canonical roots and canonical Lesson IDs. No R2 writes are performed by this staging data.
- User-confirmed ScreenPal URL templates are authoritative for trusted legacy short codes. Explicit video content/watch/embed URLs and quiz direct/embed URLs may be materialised in Phase 11 staging. The supplied quiz example confirms the quiz player ID is the lesson's legacy standard video ID.
- Five Year 5 English 11+ supplementary folders have confirmed chronological component anchors in ENGLISH_Y5; none creates a new core entitlement.
- The resource-pairing gate is resolved across all 852 active resource families after seven reviewed exclusions and one classifier correction.

## Important staging decisions

- Year 4 Maths migration exceptions reserve Y4M36-Y4M39 for the unnumbered transition and Money 1-3 collision cases; Estimate, Compare & Calculate Money retains Y4M1.
- The second Year 3 Y3M14 occurrence (Fractions 4) is staged as Y3M40.
- Five Year 6-only duplicate Ratio and Proportion occurrences are staged as Y6M46-Y6M50.
- Nineteen Year 6 SATs lessons are staged as canonical Y6M51-Y6M69 while retaining the existing student-facing Y6M1-Y6M19 aliases.
- The second distinct Year 6 English Y6E14 occurrence is staged as Y6E33.
- Year 5 English 11+ supplementary anchors are confirmed as: Y5T3EE28 -> Y5E31, Y5T3EE30 -> Y5E34, Y5T3EE32/Y5T3EE33 -> Y5E37, and Y5T3EE35 -> Y5E39.

## Resource-pairing status

- Active PDF manifest rows after reviewed exclusions: 1,646.
- Explicit R2 exclusions: 7.
- Active resource families: 852; resolved families: 852.
- Primary sheet -> answer relations: 660.
- Genuine sheet-only resources retained: 241.
- Additional genuine protected answer resources retained: 77.
- Protected answer relations: 737; unprotected answer relations: 0.
- No Answer Pack was fabricated to make a resource family symmetrical.
- The former Y4E36 orphan 11+ PreLesson answer was a classifier artefact and is corrected to VR PreLesson.

## ScreenPal status

- 123 trusted standard-video short codes can be materialised to explicit ScreenPal content/watch/embed URLs.
- 2 trusted 11+ video override short codes can be materialised to explicit ScreenPal content/watch/embed URLs.
- 79 trusted quiz short codes can be materialised to explicit ScreenPal quiz URLs and explicit quiz embed URLs using the corresponding legacy standard video short code as the player ID.
- 10 mapped VR video short codes can be materialised to explicit ScreenPal embed URLs; one legacy VR reference belongs to an excluded/unmapped game lesson and remains outside the ordinary Phase 11 catalogue.
- `worker/src/index-phase11.js` and `worker/src/phase11-screenpal.js` implement explicit stored-URL consumption while reusing the completed Phase 10/9/8/7 access checks.
- The normal `worker/wrangler.toml` still points to `src/index-phase10-history.js`, so the Phase 11 Worker layer is not deployed or active yet.
- The existing 11+ presentation gate remains unchanged: normal views receive no quiz URL/model; 11+ views may receive the approved quiz model.

## Files

- `canonical_lessons_staging.csv` — canonical lesson identities, presentation aliases and metadata status.
- `catalogue_metadata_staging.json` — source-grounded descriptions and ScreenPal provenance where present.
- `resource_manifest_staging.csv` — selected student-facing PDF resources and exact proposed R2 keys.
- `resource_pairings_staging.csv` — original aggregate pairing audit by lesson and resource family.
- `RESOURCE_PAIRING_RESOLUTION.md` — resolved pairing rules and audit result.
- `resource_pairing_resolution_summary.json` — machine-readable resolved pairing gate.
- `resource_exclusions_staging.csv` — the seven reviewed PDFs excluded from Phase 11 R2.
- `resource_reclassifications_staging.csv` — the Y4E36 VR PreLesson classifier correction.
- `migration_exceptions_staging.csv` — collision/new-ID decisions and unresolved migration cases.
- `english_y5_supplements_staging.csv` — Year 5 English 11+ supplementary source folders and confirmed component anchors.
- `vr_video_provenance_staging.csv` — legacy VR video short-code provenance.
- `shared_math_shadow_sources.csv` — duplicate Year 6 physical copies not selected as the canonical Level 3 R2 source.
- `validation_summary.json` — machine-readable staging validation.
- `../PHASE11_SCREENPAL_URL_RULES.md` — owner-confirmed ScreenPal URL/embed templates, canonical record fields and quiz-player pairing rule.

## Current gate

This set is intentionally **not deployable yet**. ScreenPal URL handling, Phase 11 explicit-URL Worker source, Year 5 English supplementary anchors, and resource pairing are resolved. Remaining gates are the canonical-ID lock, Phase 11 modelling of protected core PreLesson answers and 11+-specific extra resources, final R2 manifest validation/upload, guarded LESSONS_KV population, activation of the Phase 11 Worker only after those gates pass, and end-to-end Phase 11 verification.
