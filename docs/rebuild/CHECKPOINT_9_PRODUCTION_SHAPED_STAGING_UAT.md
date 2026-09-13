# FPT Portal V2 Performance Rebuild — Checkpoint 9

**Checkpoint:** 9 — Production-shaped staging / UAT  
**Status:** **PASS**  
**Evidence date:** 13 September 2026

## 1. Gate decision

Checkpoint 9 is PASS.

The rebuilt Student Worker and the exact accepted Checkpoint 7 frontend were exercised together in isolated, production-shaped staging using the current production catalogue shape and a representative set of real production resource objects. Synthetic UAT identities and generated four-character credentials were used; production student login passwords and Answer Pack passwords were not copied to staging.

The full exact-SHA gate passed on backend candidate:

`75de9ed17cfe7636819e5c457ac4b4e8f83ed9bf`

GitHub Actions:

- workflow: `Rebuild Checkpoint 9 - Production-shaped Staging UAT`
- run: `34782226321`
- job: `103791420256`
- conclusion: **success**
- gate marker: `REBUILD_CHECKPOINT9_FULL_GATE_PASS`

Accepted frontend source tested unchanged:

- repository: `FuturePerfectTuitions/futureperfect-lessons-test`
- Checkpoint 7 SHA: `a4513da67ee66f51212114620c8e401bd5e31a8c`
- built-tree SHA-256: `5a34605175ddd5ad54a4c41fc3f9ae686273aebd5d328cdaf327d35a73304e93`

## 2. Production-shaped seed

The guarded staging compiler read the existing production catalogue as a source and produced the isolated staging models. The seed confirmed:

- 11 curriculum records
- 15 presentation catalogues
- 372 canonical Lesson IDs

Representative real lesson cases included:

- ordinary Year 6 Maths: `Y6M2.1`
- SATs: `Y6M51`
- L3 / 11+ video presentation: `Y6M2.2`
- Year 6 English: `Y6E1`
- PreLesson-only: `Y5E5`
- L2 cumulative Homework: `Y5M2`
- explicitly blocked lesson: `Y5M1`
- historical access: `Y4M2`
- guest/manual access: `Y3M1`

Synthetic UAT personas covered normal Year 6, L2 11+, L3 11+, historical/current access, guest/manual access, locked preview and PreLesson-only states.

## 3. Real resource staging

The production materials bucket was used only as a read-only source for representative objects. The staging Worker was never bound to the production R2 bucket.

The guarded copy completed with:

- source read-only: **true**
- isolated destination: **true**
- representative objects copied: **34**
- total bytes: **19,333,554**
- marker: `REBUILD_CHECKPOINT9_R2_COPY_PASS`

## 4. Isolated staging runtime

The Checkpoint 9 Student Worker remained isolated under:

`fpt-portal-v2-rebuild-student-staging`

It used rebuild-only staging stores for prepared read models, synthetic UAT students, Answer-Pack attempt rate limiting and representative material delivery.

The deployed API gate passed all required cases, including:

- multi-device session coexistence
- normal Maths/English navigation
- ordinary resource delivery
- live Answer Pack password verification
- Answer Pack failure rate limiting
- SATs
- canonical `cumulative-homework` delivery for L2
- L3 video redirect
- Current/Previous history
- locked preview
- guest/manual access
- PreLesson-only isolation

Gate marker: `REBUILD_CHECKPOINT9_STAGING_UAT_PASS`.

## 5. Same-origin browser staging and cookie architecture

The approved authentication architecture was not weakened for staging. The session cookie remains:

- name: `fpt_session`
- Secure
- HttpOnly
- SameSite=Lax
- absolute Max-Age: 28,800 seconds / 8 hours

To test that architecture correctly in a real browser, Checkpoint 9 serves the exact Checkpoint 7 build from an isolated same-origin browser facade:

`fpt-portal-v2-rebuild-browser-staging-cp9`

The facade reaches the isolated Student Worker through a Cloudflare service binding named `STAGING_API`. Browser API calls therefore stay on the facade origin; the browser is not sent directly to the staging Worker hostname and no production Worker is bound to the facade.

The browser gate proved:

- `directBackendBrowserRequestCount = 0`
- `productionBrowserRequestCount = 0`
- browser API requests remained same-origin
- approved SameSite=Lax cookie architecture remained unchanged

## 6. Real browser UAT

The exact Checkpoint 7 frontend was exercised against the production-shaped staging backend with real Chromium and WebKit engines.

The browser gate passed:

- login/bootstrap
- 8-hour Secure / HttpOnly / SameSite=Lax session cookie
- Maths Year 6 catalogue navigation
- canonical lesson-control → lesson-detail binding
- lazy ScreenPal video path
- ordinary Homework capability delivery
- password-protected Answer Pack and protected PDF viewer
- SATs
- English
- L2 cumulative Homework
- blocked lesson preview with no protected/direct controls
- L3 video
- Current / Previous access
- guest/manual access
- locked upsell preview
- PreLesson-only isolation
- multi-device logout isolation
- stale navigation cancellation
- bounded timeout + retry state
- mobile layout / no horizontal overflow
- WebKit iPad smoke path

Gate marker: `REBUILD_CHECKPOINT9_BROWSER_UAT_PASS`.

Observed staging timings from the successful browser run:

| Operation | Time |
|---|---:|
| Initial login screen | 287 ms |
| Normal persona login | 1,434 ms |
| Maths → Year 6 | 355 ms |
| Ordinary lesson open | 300 ms |
| L2 persona login | 519 ms |
| L3 persona login | 528 ms |
| Historical persona login | 485 ms |
| PreLesson-only persona login | 746 ms |

These are staging observations, not yet the formal Checkpoint 10 performance acceptance thresholds.

## 7. UAT corrections found before PASS

Checkpoint 9 deliberately stopped on failures until the production-shaped behaviour was understood.

The relevant corrections were confined to staging/test infrastructure:

1. Phase 11 cumulative Homework uses the canonical resource type `cumulative-homework`; the UAT was corrected to test that type directly.
2. The historical UAT persona was given its prior-academic-year source lesson date so a genuine old entitlement remains Previous rather than being interpreted as a current-year release.
3. The browser facade was changed from an external workers.dev → workers.dev hop to a Cloudflare service binding so SameSite=Lax remains valid without weakening cookie policy.
4. The browser harness stopped assuming the canonical backend Lesson ID must be visible text. It now uses the CP7 `data-lesson` canonical control binding and verifies the returned lesson-detail payload instead; CP7 may legitimately display a presentation Lesson ID.

No production application behaviour was changed to make these tests pass.

## 8. Production unchanged proof

Before and after the successful full gate, production remained exactly:

- Worker: `fpt-portal-v2-worker`
- deployment: `ce193be0-d018-403f-a417-999e9e6eea41`
- version: `aed13a31-21fa-49c3-8830-c37fd8645c31`

The gate evidence records:

`productionChanged: false`

Production remains in legacy-authoritative shadow mode. Student reads have not been cut over to the rebuild. The live frontend branch/domain was not changed by Checkpoint 9.

## 9. Evidence artifact

Successful run artifact:

- name: `checkpoint9-production-shaped-uat-evidence`
- artifact ID: `10325596998`
- size: `1,596,075` bytes
- digest: `sha256:c67052eaf0d43e5a5e9ed64ff96b496de3b3bb44efc44391e64b65896005f3ba`
- attached to exact backend SHA `75de9ed17cfe7636819e5c457ac4b4e8f83ed9bf`

The artifact contains the seed summary, R2 copy summary, API UAT summary, exact frontend provenance, browser UAT summary, production-anchor proof, request trace with capability values redacted, and browser screenshots including protected Answer Pack, English, historical access, locked preview, L3, PreLesson-only, timeout/retry, mobile and WebKit paths.

## 10. Exit condition

**Checkpoint 9 exit condition is satisfied: production-shaped staging/UAT passes while production remains unchanged.**

Checkpoint 10 — Performance / Security Acceptance — is the next official checkpoint and has not been started by this document.
