# Repository instructions for coding agents

## Portal V2 continuation authority — mandatory first read

Before changing or diagnosing **any** FPT Portal V2, Admin Console, Trial, student-auth/session, access/read-model, lesson-release, resource, protected-answer, PreLesson/VR, parent-email or quiz-bridge behaviour, read this file in full and then read, in this order:

1. `gch/portal-v2-current/GCH_CURRENT.json`
2. `gch/portal-v2-current/GCH_STATE.json`
3. `gch/portal-v2-current/GCH_OVERRIDE_2026-09-23_REPLACE_RESOURCE.json`
4. `gch/portal-v2-current/GCH_OVERRIDE_2026-09-23_QUIZ_BRIDGE_COMPOSITION.json`
5. `gch/portal-v2-current/WEBSITE_WORKFLOW_2026-09-23.json`

`GCH_CURRENT.json` is the machine-oriented restart entrypoint for the current authority set. The base GCH reconciles the historical v4.2 Master with current repository topology and the 22 September 2026 Admin/Trial work. The 23 September Replace Resource override is higher authority only for the scope it explicitly supersedes. The 23 September Quiz Bridge Composition override is higher authority only for the shared `fpt-portal-v2-worker` top-level composition and the associated bridge-preservation incident/repair state. All non-conflicting base GCH content remains binding. The full-site workflow file is the current end-to-end execution map for the entire Portal/Admin website and ties each major workflow to its canonical state, prepared projection, public API/browser verification and preservation obligations. Together, these files form the current Portal V2 GCH authority set unless the owner explicitly changes them.

Do not start from an old Master ZIP, old Phase file, branch age, screenshot similarity, Admin UI state, D1/KV state or repository `main` alone. Freshly prove the live route/deployment/source lineage and trace the complete source/write -> canonical state -> prepared projection -> public API -> browser chain before mutation. If behaviour/topology/data authority/routes/workflows/open-defect status or the authority set changes, update `GCH_CURRENT.json` and the applicable authority file in the same coherent change.

In particular, do not claim the Trial one-successful-login rule is fully enforced until the GCH open gate is actually closed and verified. Normal-student multi-device behaviour must not be changed merely to repair Trial semantics.

For **Replace Resource**, do not regress to source-only success. The current required contract is recorded in `GCH_OVERRIDE_2026-09-23_REPLACE_RESOURCE.json` and incorporated into `WEBSITE_WORKFLOW_2026-09-23.json`: success requires both the canonical resource and the current prepared lesson projection to publish/read back the replacement; projection failure must fail closed rather than show a false Admin success. The Y5E2 incident was owner-browser-verified as working on 2026-09-23 and is closed evidence for this invariant. Also preserve browser transport semantics: only a real POST replacement is subject to consistency processing. `OPTIONS` CORS preflight and other non-POST methods must pass through to the base resource handler; never interpret preflight `{ok:true}` as a completed replacement response. The L3T2M24/Y6M1.4 `Failed to fetch` incident is the regression evidence for this rule.

For the shared production Worker, do not deploy Admin Tools as a mutually exclusive replacement for the Quiz bridge. The current composition authority requires `worker/src/index-step10-quiz-bridge.js` as the canonical outer production entrypoint; it delegates all non-quiz traffic to `worker/src/index-admin-tools.js`. Every shared-Worker deploy must preserve the bridge, Admin, Trial, protected-view and Replace Resource capabilities together, with a rollback anchor and post-deploy regression evidence.

## Important repository boundary

This repository, `FuturePerfectTuitions/futureperfect-lessons-v2`, is **not the canonical live student-facing Portal V2 frontend repository**.

The live frontend served at `https://lessons.futureperfect.education` is:

`FuturePerfectTuitions/futureperfect-lessons-test`

## Mandatory targeting rule

If the user asks for a live Portal V2 HTML, CSS, JavaScript, layout, styling, navigation, button or other student-facing frontend change, do **not** edit the frontend copies in this repository unless the user explicitly says to work on the development copy.

For live frontend work, switch to `FuturePerfectTuitions/futureperfect-lessons-test`, verify its root `CNAME` contains `lessons.futureperfect.education`, and inspect its `index.html` for the currently loaded assets.

## What remains here

This repository contains Portal V2 development/history plus Worker/backend, tests, operations and deployment material. Do not delete files here simply because the frontend is live elsewhere; first prove that a file is unreferenced by Worker builds, workflows, tests, scripts, deployment or rollback paths.
