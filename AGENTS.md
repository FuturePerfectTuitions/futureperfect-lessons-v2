# Repository instructions for coding agents

## Portal V2 continuation authority — mandatory first read

Before changing or diagnosing **any** FPT Portal V2, Admin Console, Trial, student-auth/session, access/read-model, lesson-release, resource, protected-answer, PreLesson/VR, parent-email or quiz-bridge behaviour, read this file in full and then read:

`gch/portal-v2-current/GCH_STATE.json`

That GCH is the current machine-oriented continuation authority. It reconciles the historical v4.2 Master with current repository topology and the 22 September 2026 Admin/Trial work. Its business invariants, preservation ledger, known open defects, failure signatures, change-impact rules, stop conditions and verification matrix are binding unless the owner explicitly changes them.

Do not start from an old Master ZIP, old Phase file, branch age, screenshot similarity, Admin UI state, D1/KV state or repository `main` alone. Freshly prove the live route/deployment/source lineage and trace the complete source/write -> canonical state -> prepared projection -> public API -> browser chain before mutation. If behaviour/topology/data authority/routes/workflows/open-defect status change, update `gch/portal-v2-current/GCH_STATE.json` in the same coherent change.

In particular, do not claim the Trial one-successful-login rule is fully enforced until the GCH open gate is actually closed and verified. Normal-student multi-device behaviour must not be changed merely to repair Trial semantics.

## Important repository boundary

This repository, `FuturePerfectTuitions/futureperfect-lessons-v2`, is **not the canonical live student-facing Portal V2 frontend repository**.

The live frontend served at `https://lessons.futureperfect.education` is:

`FuturePerfectTuitions/futureperfect-lessons-test`

## Mandatory targeting rule

If the user asks for a live Portal V2 HTML, CSS, JavaScript, layout, styling, navigation, button or other student-facing frontend change, do **not** edit the frontend copies in this repository unless the user explicitly says to work on the development copy.

For live frontend work, switch to `FuturePerfectTuitions/futureperfect-lessons-test`, verify its root `CNAME` contains `lessons.futureperfect.education`, and inspect its `index.html` for the currently loaded assets.

## What remains here

This repository contains Portal V2 development/history plus Worker/backend, tests, operations and deployment material. Do not delete files here simply because the frontend is live elsewhere; first prove that a file is unreferenced by Worker builds, workflows, tests, scripts, deployment or rollback paths.