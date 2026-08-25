# Phase 11 Change 8 — visual redesign/refinement

Status: **OWNER APPROVED — ACTIVATION IN PROGRESS**

Owner visual sign-off was given on 25 August 2026 after reviewing the isolated `phase11-change8.html` development preview.

Change 8 is presentation-only and remains inside Phase 11. It does not begin Phase 12.

## Scope

- Add a polished, modern FPT visual layer for the Phase 11 student portal.
- Preserve the established FPT navy/red identity while reducing visual heaviness and improving hierarchy, spacing and card treatment.
- Refine login, top bar, subject choice, Year/Level cards, lesson catalogue rows, lesson detail/resource sections and protected Answer Pack presentation.
- Improve mobile responsiveness and reduced-motion behaviour.

## Approved activation

The owner-approved preview is being activated on `phase11.html` by making the active Phase 11 page exactly match `phase11-change8.html`.

The activation preserves the same DOM IDs and JavaScript source order and does not change Worker code, KV, D1, R2, catalogue data, entitlements, Current/Previous behaviour, single-device login, Phase 8 protected answers, Phase 9 English/VR/quiz rules, Phase 10 special content, or Change 7 Homework mappings.

A Change 8 static guard requires the active Phase 11 page to remain byte-equivalent to the approved preview and verifies that the visual stylesheet stays scoped to `body.phase11-change8`.

No production/live portal is targeted.
