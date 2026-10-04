# Repository instructions for coding agents

## Portal V2 continuation authority — mandatory first read

Before changing or diagnosing **any** FPT Portal V2, Admin Console, Trial, student-auth/session, access/read-model, lesson-release, resource, protected-answer, PreLesson/VR, parent-email, quiz-bridge **or lesson-video** behaviour, read this file in full and then read, in this order:

1. `gch/portal-v2-current/GCH_CURRENT.json`
2. `gch/portal-v2-current/GCH_STATE.json`
3. `gch/portal-v2-current/GCH_OVERRIDE_2026-09-23_REPLACE_RESOURCE.json`
4. `gch/portal-v2-current/GCH_OVERRIDE_2026-09-23_QUIZ_BRIDGE_COMPOSITION.json`
5. `gch/portal-v2-current/GCH_OVERRIDE_2026-09-25_ADMIN_BATCH_CREATION.json`
6. `gch/portal-v2-current/GCH_OVERRIDE_2026-09-25_ADMIN_PORTAL_LOOKUP.json`
7. `gch/portal-v2-current/WEBSITE_WORKFLOW_2026-09-23.json`
8. `gch/portal-v2-current/GCH_OVERRIDE_2026-09-26_Y6_SATS_DIRECT_RELEASE.json`
9. `gch/portal-v2-current/GCH_OVERRIDE_2026-09-30_VIDEO_UPDATE_PLAYBOOK.json`
10. `gch/portal-v2-current/GCH_OVERRIDE_2026-09-30_L3T2M24_L3_ONLY.json`
11. `gch/portal-v2-current/evidence/2026-09-27_Y6_EQUIVALENT_ROSTER_AUDIT.json`
12. `gch/portal-v2-current/GCH_OVERRIDE_2026-09-26_FORWARD_ONLY_ADMIN_EMAIL_RECOVERY.json`
13. `gch/portal-v2-current/evidence/2026-10-04_Y6_CHRONOLOGICAL_LIVE_BROWSER_WORKER_FIX.json`

`GCH_CURRENT.json` is the machine-oriented restart entrypoint for the current authority set. The base GCH reconciles the historical v4.2 Master with current repository topology and the 22 September 2026 Admin/Trial work. The 23 September Replace Resource override is higher authority only for the scope it explicitly supersedes. The 23 September Quiz Bridge Composition override is higher authority only for the shared `fpt-portal-v2-worker` top-level composition and the associated bridge-preservation incident/repair state. The 25 September Admin Batch Creation override is higher authority only for creating a distinct new batch definition from an existing batch inside Student Login Manager before ordinary student provisioning. The 25 September Admin Portal Lookup override is higher authority only for the read-only Portal Login Details lookup and its non-mutation/credential-exposure boundary. The 30 September Video Update Playbook is the current general authority for lesson-video additions/replacements: canonical lesson state and current prepared lesson projection must be handled together, exact ScreenPal IDs must come from the pasted URL, and stream/catalogue/access state must only be changed when owner intent actually changes lesson classification. The 30 September L3T2M24 override is higher authority within `Y6M1.4` / `L3T2M24`: that lesson is L3/11+-only and must never be reintroduced into normal Year 6. All non-conflicting base GCH content remains binding. The full-site workflow file is the current end-to-end execution map for the entire Portal/Admin website and ties each major workflow to its canonical state, prepared projection, public API/browser verification and preservation obligations. Together, these files form the current Portal V2 GCH authority set unless the owner explicitly changes them.

Do not start from an old Master ZIP, old Phase file, branch age, screenshot similarity, Admin UI state, D1/KV state or repository `main` alone. Freshly prove the live route/deployment/source lineage and trace the complete source/write -> canonical state -> prepared projection -> public API -> browser chain before mutation. If behaviour/topology/data authority/routes/workflows/open-defect status or the authority set changes, update `GCH_CURRENT.json` and the applicable authority file in the same coherent change.

In particular, do not claim the Trial one-successful-login rule is fully enforced until the GCH open gate is actually closed and verified. Normal-student multi-device behaviour must not be changed merely to repair Trial semantics.

For **Student Login Manager batch creation**, treat creating a batch definition and creating a student login as separate authenticated operations. Copying settings from an existing batch must not mutate that template batch. Do not claim that a particular new batch or student exists merely because repository support is present; require the actual Admin mutation and readback. Keep the `Copy settings from` dropdown human-readable, including visible separation between the batch code and its type/description.

For **Portal Login Details lookup**, the Admin surface is read-only. It may read the existing student record from `STUDENTS_KV` and show the Portal username/account details plus whether Login and Answer Pack credentials are stored. It must not reset, rewrite, return or expose the stored credential values, and it must not change batches, entitlements, sessions, prepared access or account state.

For **lesson-video additions/replacements**, do not regress to canonical-KV-only success. Read `GCH_OVERRIDE_2026-09-30_VIDEO_UPDATE_PLAYBOOK.json`. ScreenPal IDs are case-sensitive: take the ID from the owner's pasted text URL, never infer an ambiguous `I/l/1/O/0` character from a screenshot. Resolve the canonical lesson and its real stream/catalogue memberships before mutation; an internal ID such as `Y6M1.4` must not be used to infer normal-Year-6 eligibility. A normal video/description replacement with unchanged classification should update canonical video/description state and the current prepared lesson stream variant, then read back both. It must not touch global catalogue membership or student access snapshots. If owner intent changes the lesson's stream classification, then and only then update the canonical display mapping/curriculum membership, prepared global catalogues/`lessonToViews`, affected access scopes and prepared video variants. Never report a lesson video as live merely because `LESSONS_KV` changed or a workflow succeeded without current prepared-lesson readback. The L3T2M24 incident is permanent regression evidence: canonical `cOQvDXnxxvX` coexisted with stale prepared `cOVTQxn3IMa`, causing the browser to keep serving the old recording until the prepared lesson scope was republished.

For **L3T2M24 / Y6M1.4**, apply the scope-specific override. `L3T2M24 Linear Sequences` is L3/11+-only; do not recreate `Y6T2M8`, `maths-year6` catalogue membership, a normal prepared-video variant or normal-Year-6-derived access. The active ScreenPal ID is `cOQvDXnxxvX`; `cOVTQxn3IMa` is obsolete. The owner later still saw a `Lessons` card on the Maths landing page after the backend/prepared lesson repair; treat that as a separate navigation/presentation investigation, not as permission to undo the L3-only classification or as proof that the video state reverted.

For **Replace Resource**, do not regress to source-only success. The current required contract is recorded in `GCH_OVERRIDE_2026-09-23_REPLACE_RESOURCE.json` and incorporated into `WEBSITE_WORKFLOW_2026-09-23.json`: success requires both the canonical resource and the current prepared lesson projection to publish/read back the replacement; projection failure must fail closed rather than show a false Admin success. The Y5E2 incident was owner-browser-verified as working on 2026-09-23 and is closed evidence for this invariant. Also preserve browser transport semantics: only a real POST replacement is subject to consistency processing. `OPTIONS` CORS preflight and other non-POST methods must pass through to the base resource handler; never interpret preflight `{ok:true}` as a completed replacement response. The L3T2M24/Y6M1.4 `Failed to fetch` incident is the regression evidence for this rule.

For the shared production Worker, do not deploy Admin Tools as a mutually exclusive replacement for the Quiz bridge. The current composition authority requires `worker/src/index-step10-quiz-bridge.js` as the canonical outer production entrypoint; it delegates all non-quiz traffic to `worker/src/index-admin-tools.js`. Every shared-Worker deploy must preserve the bridge, Admin, Trial, protected-view and Replace Resource capabilities together, with a rollback anchor and post-deploy regression evidence.

## Important repository boundary

This repository, `FuturePerfectTuitions/futureperfect-lessons-v2`, is **not the canonical live student-facing Portal V2 frontend repository**.

The canonical live frontend source is:

`FuturePerfectTuitions/futureperfect-lessons-test` branch `source/live-v2-current`.

The actual production serving path is **not GitHub Pages while the current Cloudflare route is active**. The live hostname is intercepted by:

`lessons.futureperfect.education/* -> fpt-portal-v2-rebuild-browser-prod`

The Browser Worker serves static frontend files through its `ASSETS` binding and proxies `/api/v2/*` through `STAGING_API` to `fpt-portal-v2-rebuild-student-prod`.

## Mandatory targeting rule

If the user asks for a live Portal V2 HTML, CSS, JavaScript, layout, styling, navigation, button or other student-facing frontend change, do **not** edit the frontend copies in this repository unless the user explicitly says to work on the development copy.

For live frontend work, use `FuturePerfectTuitions/futureperfect-lessons-test` branch `source/live-v2-current`, read `V2_SOURCE_STATE.json`, and preserve the exact accepted base source unless the requested change explicitly supersedes it. Production deployment must update the `ASSETS` payload of `fpt-portal-v2-rebuild-browser-prod` using the preserved runtime source/config in `ops/live-browser-worker-prod/`, then prove the live hostname serves the exact rebuilt assets and that the API service binding is unchanged. A GitHub Pages deployment alone is not evidence of a live Portal deployment.

## What remains here

This repository contains Portal V2 development/history plus Worker/backend, tests, operations and deployment material. Do not delete files here simply because the frontend is live elsewhere; first prove that a file is unreferenced by Worker builds, workflows, tests, scripts, deployment or rollback paths.
