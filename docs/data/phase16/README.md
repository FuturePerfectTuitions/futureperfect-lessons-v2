# Phase 16 — Device / Browser / Resource / Session Acceptance Closure

Status: **CLOSED / PASS**

Owner acceptance: **ACCEPTED on 2026-08-29**.

Authoritative baseline:
- Phase 15 merged main: `e9f1085c6797d51a9a14b2d6b118a4fb94576f38` (PR #125)
- Master: FPT Portal V2 — Master Authoritative Specification v3.4
- Steps: FPT Portal V2 — Steps to Progression v2.4
- Handover: FPT Portal V2 — Implementation Handover v4.6
- Canonical catalogue: 369 lessons / 11 curricula
- Catalogue SHA-256: `7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663`

## Final automated acceptance evidence

Final Phase 16 acceptance run: GitHub Actions run `33245569580` on head `70b0bdec10c4c9c84d8b921d9c06f5084b266727` — **SUCCESS**.

That run passed:
- repository reconciliation and inherited Phase 11–15 static/regression gates;
- canonical 369-lesson / 11-curriculum catalogue and locked catalogue hash;
- guarded isolated development Worker deployment;
- development-only binding and login guards;
- exact D1 baseline preflight and post-test restoration;
- owner UI refinement static verification;
- real Google Chrome desktop, compact, mobile-like and tablet responsive journeys;
- Firefox cross-browser journeys;
- long-list navigation, search, Current/Previous grouping, retained-history and locked-preview behaviour;
- exact authenticated PreLesson, Homework and Other Resource paths with no raw R2 leakage;
- protected Answer Pack prompt, eye control, PDF viewer, re-open, session invalidation and password-change invalidation;
- ordinary ScreenPal playback and fullscreen;
- one-active-session enforcement across browser/device contexts;
- two-hour inactivity expiry and video-activity session behaviour;
- controlled fixture/session cleanup; and
- final exact baseline/isolation verification.

Final evidence artifact: `phase16-browser-resource-session-evidence` from run `33245569580`, artifact id `9712810133`, digest `sha256:a593ccfd135a13d6acb7f84644b5dec3686e25f443237af924913f14a7c302be`.

The final run reported `PHASE16_AUTOMATED_MATRIX_PASS_WITH_NOT_CONFIRMED_WEBKIT_COMPATIBILITY`. Playwright WebKit on the Linux runner did not establish the cross-site session cookie in the GitHub Pages → Worker topology. That engine-only signal is not treated as Safari acceptance. The required real Safari/iPad acceptance was subsequently completed by the owner on physical Apple platforms, so this non-Safari Playwright limitation is not a remaining acceptance blocker.

## Owner / real-device acceptance

On 2026-08-29 the owner explicitly confirmed **all requested manual gates PASS**, after the final UI refinement was published:
- Windows / Google Chrome: authorised 11+ Maths interactive ScreenPal content in the **Lesson Video** slot — playback **PASS**, fullscreen **PASS**, no separate Quiz section, compact View/Hide presentation accepted;
- physical Android / Chrome: login, Maths/English navigation, Year 5 list/scroll, lesson open/back navigation and resource presentation — **PASS**;
- physical iPad / Safari: login, subject/year/lesson navigation and resource presentation — **PASS**;
- macOS / Safari: login, subject/year/lesson navigation and resource presentation — **PASS**.

The owner supplied the required platform/browser acceptance result but did not separately provide device model, OS build or browser-version metadata. Those details are therefore not invented in this closure record.

The manual 11+ ScreenPal result resolves the automation-only `elevenPlusPlayback=NOT_CONFIRMED` / `elevenPlusFullscreen=NOT_CONFIRMED` limitation. The physical Android, iPad Safari and macOS Safari results resolve the corresponding physical-platform `NOT_CONFIRMED` entries from the automated run.

## Phase 16 presentation refinements accepted

During owner review, three presentation-only refinements were requested and implemented without changing entitlement, resource, catalogue or session semantics:
1. back navigation is collapsed to an extreme-left arrow and unfurls its contextual label on hover/focus;
2. the duplicate Lesson Video presentation was removed so the existing View/Hide action sits compactly at the right of the main Lesson Video heading; and
3. redundant ordinary-state copy such as `Available` / `Ready to download` was removed or neutralised while useful locked-state information remains.

A final narrow-screen correction prevents the Lesson Video View/Hide action from inheriting the generic 100%-width mobile resource-button rule and covering the heading.

## Defects / compatibility findings completed during Phase 16

1. Manual-only historical views are canonicalised after the Phase 15 manual-access overlay, preserving the full locked catalogue rather than collapsing to only the manually open lesson.
2. The session cookie is emitted as an HttpOnly, Secure, SameSite=None, Partitioned cookie for standards-based cross-site session transport without exposing a bearer token to JavaScript, storage, query strings or Authorization headers.
3. WebKit Linux compatibility remains a non-authoritative engine signal only; physical Safari/iPad owner testing is the acceptance authority for the required Safari gates.
4. Phase 16 workflow deployment generates the locked navigation manifest before guarded Worker deployment so the deployed test Worker uses the actual 369/11 manifest rather than the checked-in placeholder.
5. Exact stale Phase 16 fixture cleanup is signature-guarded and final cleanup restores only controlled TestY KV/session state plus the documented D1 baseline.
6. The responsive Lesson Video action is explicitly kept compact beside the title on narrow screens.

## Baseline restored

The final acceptance run restored and re-verified the accepted operational baseline:
- `632` lesson entitlements;
- `4` batch definitions;
- `4` student batch assignments;
- `0` batch lesson releases;
- `2` assigned real development users;
- `173` entitlements belonging to assigned users;
- no Phase 16 temporary batch, assignment, release or entitlement fixtures;
- `trg_student_sessions_single_active` present;
- D1 `quick_check = ok`;
- isolated Worker remains `development`;
- development R2 binding remains `fpt-materials-dev`;
- legacy `FPT_LESSONS_TEST` remains unbound; and
- normal student login remains disabled.

No production login, DNS/CNAME, production route, live cutover, canonical catalogue rewrite, Excel membership mutation or Phase 17 work is included in this closure.

## Closure decision

All required Phase 16 static, API, D1, browser, real-device, resource, ScreenPal, session and owner-acceptance gates are now satisfied. Phase 16 is therefore **CLOSED / PASS**.

PR #126 may be merged into `main` only after this closure-record head passes its applicable checks. After merge, the exact development baseline/isolation state must be rechecked before any later phase is started.

**Phase 17 has not started.**
