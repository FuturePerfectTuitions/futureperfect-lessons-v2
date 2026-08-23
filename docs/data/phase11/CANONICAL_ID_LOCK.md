# Phase 11 canonical Lesson ID lock

Status: **LOCKED FOR PHASE 11 MIGRATION**

The Phase 11 canonical migration IDs are now fixed for catalogue serialization. This is an implementation/data-migration lock only; it does not alter the student-facing aliases already established by the current folder sequence.

## Validation basis

The reconciled staging catalogue contains:

- **369** ordinary canonical lesson records;
- **369** unique canonical Lesson IDs;
- **369** populated normal-view aliases with **0 duplicate normal aliases**;
- **183** populated 11+ aliases with **0 duplicate 11+ aliases**.

The lock preserves the authoritative rule that the canonical/internal Lesson ID is the immutable entitlement/content key while the exact student-facing ID may vary by view.

## Collision / new-ID lock

- Year 3 Fractions 4: **Y3M40** (the historical Y3M14 value is already occupied by a different lesson).
- Year 4 / Level 1 transition: **Y4M36**.
- Year 4 / Level 1 Money 1-3 collision set: **Y4M37, Y4M38, Y4M39**.
- Additional normal Year 6 Ratio and Proportion 1-5: **Y6M46-Y6M50**.
- Year 6 SATs sequence: **Y6M51-Y6M69**, while retaining the existing student-facing SATs aliases **Y6M1-Y6M19**.
- Year 6 English SATs Preparation Grammatical Terms & Word Classes: **Y6E33**, while the separate Subjunctive and Modal lesson retains **Y6E14**.

These IDs are deliberately outside the conflicting historical keys and do not replace the established display aliases.

## Shared curriculum rule remains unchanged

This lock does not create separate canonical copies for normal and 11+ views:

- Year 4 / Level 1 Maths remains one shared canonical curriculum.
- Year 5 / Level 2 Maths remains one shared canonical curriculum.
- Year 6 core / Level 3 Maths remains one shared canonical curriculum.
- Year 4 and Year 5 normal/11+ English continue to share their core English canonical lesson identity.

Year 5 English 11+ supplementary material is attached as presentation/resource components to the confirmed existing core anchors; it is not assigned new core entitlement IDs.

## Immutability boundary

Once the Phase 11 catalogue is applied to V2 LESSONS_KV, the canonical IDs listed here must be treated as immutable entitlement/content keys. Titles, descriptions, student-facing aliases, R2 paths and ScreenPal URLs may be corrected later without changing these IDs.

This lock performs no Cloudflare write, no R2 upload, no LESSONS_KV population, no D1 change, no student-permission change and no live-portal change.
