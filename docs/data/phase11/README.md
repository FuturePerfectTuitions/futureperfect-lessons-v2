# Phase 11 canonical catalogue staging

Status: **STAGING ONLY — NOT A PRODUCTION APPLY**

This directory reconciles the cleaned Phase 11 resource inventory with the current read-only legacy Lessons KV audit and the V2 canonical curriculum rules.

## What is locked in this staging set

- 369 canonical ordinary lessons across 11 canonical curriculum keys.
- Shared Maths is deduplicated: Year 4/Level 1, Year 5/Level 2 and Year 6 core/Level 3 use one canonical lesson record per underlying lesson.
- English Year 4 and Year 5 normal/11+ use one core canonical lesson identity; 11+ supplementary/VR resources remain components, not duplicate core entitlements.
- Current source-folder codes are retained separately from canonical/internal Lesson IDs.
- Proposed R2 target keys use canonical roots and canonical Lesson IDs. No R2 writes are performed by this staging data.
- User-confirmed ScreenPal URL templates are now authoritative for trusted legacy short codes. Explicit video content/watch/embed URLs and quiz direct/embed URLs may be materialised in Phase 11 staging. The supplied quiz example confirms the quiz player ID is the lesson's legacy standard video ID.

## Important staging decisions

- Year 4 Maths migration exceptions reserve Y4M36-Y4M39 for the unnumbered transition and Money 1-3 collision cases; Estimate, Compare & Calculate Money retains Y4M1.
- The second Year 3 Y3M14 occurrence (Fractions 4) is staged as Y3M40.
- Five Year 6-only duplicate Ratio and Proportion occurrences are staged as Y6M46-Y6M50.
- Nineteen Year 6 SATs lessons are staged as canonical Y6M51-Y6M69 while retaining the existing student-facing Y6M1-Y6M19 aliases.
- The second distinct Year 6 English Y6E14 occurrence is staged as Y6E33.
- Five Year 5 English 11+ supplementary folders are not new core lessons. Their chronological anchors are proposals and remain explicitly flagged.

## ScreenPal status

- 123 trusted standard-video short codes can now be materialised to explicit ScreenPal content/watch/embed URLs.
- 2 trusted 11+ video override short codes can now be materialised to explicit ScreenPal content/watch/embed URLs.
- 79 trusted quiz short codes can now be materialised to explicit ScreenPal quiz URLs and explicit quiz embed URLs using the corresponding legacy standard video short code as the player ID.
- 10 mapped VR video short codes can now be materialised to explicit ScreenPal embed URLs; one legacy VR reference belongs to an excluded/unmapped game lesson and remains outside the ordinary Phase 11 catalogue.
- Runtime Worker code must consume the stored explicit URL. It must not reconstruct provider URLs from bare IDs at request time.
- The existing 11+ presentation gate remains unchanged: normal views receive no quiz URL/model; 11+ views may receive the approved quiz model.

## Files

- `canonical_lessons_staging.csv` — canonical lesson identities, presentation aliases and metadata status.
- `catalogue_metadata_staging.json` — source-grounded descriptions and ScreenPal provenance where present.
- `resource_manifest_staging.csv` — selected student-facing PDF resources and exact proposed R2 keys.
- `resource_pairings_staging.csv` — pairing status by lesson and resource family.
- `migration_exceptions_staging.csv` — collision/new-ID decisions and unresolved migration cases.
- `english_y5_supplements_staging.csv` — Year 5 English 11+ supplementary source folders and proposed anchors.
- `vr_video_provenance_staging.csv` — legacy VR video short-code provenance.
- `shared_math_shadow_sources.csv` — duplicate Year 6 physical copies not selected as the canonical Level 3 R2 source.
- `validation_summary.json` — machine-readable staging validation.
- `../PHASE11_SCREENPAL_URL_RULES.md` — owner-confirmed ScreenPal URL/embed templates and quiz-player pairing rule.

## Current gate

This set is intentionally **not deployable yet**. The ScreenPal URL-shape blocker is now resolved for the trusted legacy video/quiz metadata. Remaining gates are multi-resource pairing, English Year 5 supplementary anchors, canonical-ID lock, migration of the Worker to consume stored explicit ScreenPal URLs, and the guarded R2/KV apply.
