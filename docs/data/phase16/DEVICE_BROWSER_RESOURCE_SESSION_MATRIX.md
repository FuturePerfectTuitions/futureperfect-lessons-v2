# FPT Portal V2 — Phase 16 device/browser/resource/session matrix

Status: **PLANNED — matrix fixed before Phase 16 execution**  
Base main SHA: `e9f1085c6797d51a9a14b2d6b118a4fb94576f38` (Phase 15 formal closure / PR #125)  
Environment: isolated V2 development only  
Worker: `fpt-portal-v2-worker.futureperfectlessons.workers.dev`  
Canonical catalogue: **369 lessons / 11 curricula**  
Catalogue SHA256: `7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663`

This matrix is the Phase 16 test contract. It is intentionally committed before the Phase 16 test harness is executed. A browser/device that is unavailable or not actually exercised must remain **NOT CONFIRMED**; compatibility emulation is not relabelled as physical-device or Safari acceptance.

## 1. Pre/post safety gates

| ID | Guard | Required result |
|---|---|---|
| G01 | Repository main before Phase 16 branch | Exact Phase 15 merge SHA above unless reconciled first |
| G02 | Worker environment | `ENVIRONMENT=development` |
| G03 | General student login | Disabled (`STUDENT_LOGIN_ENABLED=false`/equivalent disabled state) |
| G04 | R2 binding | `fpt-materials-dev` only |
| G05 | Legacy lesson KV | `FPT_LESSONS_TEST` not bound to V2 Worker |
| G06 | Catalogue | 369 lessons / 11 curricula; locked SHA256 unchanged |
| G07 | D1 baseline | 632 `lesson_entitlements`; 4 `batch_definitions`; 4 `student_batch_assignments`; 0 `batch_lesson_releases` |
| G08 | Assigned real development population | 2 assigned users / 173 entitlement rows |
| G09 | Phase 15 fixtures | No P15 temporary batch/assignment/release/entitlement fixtures |
| G10 | Session invariant | `trg_student_sessions_single_active` present |
| G11 | D1 integrity | `PRAGMA quick_check = ok` |
| G12 | Production isolation | No DNS/CNAME/production-route/live-portal mutation |

Every temporary Phase 16 mutation must be confined to established development/test personas, record its exact start time/key, be cleaned in `always()`/trap logic, and finish with G02–G12 reverified.

## 2. Device/browser/layout matrix

| ID | Platform / engine | Execution | Viewport / input | Required workflows | Initial status |
|---|---|---|---|---|---|
| B01 | Desktop Google Chrome stable on GitHub Ubuntu runner | Automated, real Chrome binary | 1440×1100, mouse/keyboard | Full browser/resource/session smoke | PLANNED |
| B02 | Desktop Google Chrome stable — compact desktop | Automated, real Chrome binary | 1024×768 | Navigation, long lists, resources, back behaviour | PLANNED |
| B03 | Mobile-Chrome-like context using Google Chrome/Chromium engine | Automated emulation; **not a physical Android claim** | 412×915, touch/mobile UA | Login, Maths/English, Current/Previous, list scroll, locked/open lesson, resources, dialogs | PLANNED |
| B04 | Narrow mobile-Chrome-like context | Automated emulation; **not a physical Android claim** | 360×800, touch/mobile UA | Overflow, horizontal-scroll guard, controls, long lists, dialog fit | PLANNED |
| B05 | Tablet/narrow responsive Chrome context | Automated | 768×1024, touch | Year/Level navigation, lesson/resource layout | PLANNED |
| B06 | Firefox desktop | Automated Playwright Firefox | 1440×1100 | Cross-browser navigation + latest-login-wins companion session | PLANNED |
| B07 | Playwright WebKit desktop compatibility signal | Automated | 1440×1100 | Navigation/resources/session smoke; **not Safari acceptance** | PLANNED |
| B08 | Playwright WebKit iPad-like compatibility signal | Automated | 820×1180, touch | Responsive/layout/navigation smoke; **not physical iPad/Safari acceptance** | PLANNED |
| B09 | Physical Android / mobile Chrome | Owner/device exercise if available | Actual device | Critical student journey + video/resource/password/session checks | NOT CONFIRMED |
| B10 | Safari on macOS | Owner/device exercise if available | Actual Safari | Critical student journey + video/resource/password/session checks | NOT CONFIRMED |
| B11 | Safari on iPadOS / iPad | Owner/device exercise if available | Actual iPad | Critical student journey + video/resource/password/session checks | NOT CONFIRMED |

Automated Chrome mobile contexts provide deterministic responsive/browser-engine coverage, but they do not prove Android hardware/browser integration. WebKit runs provide engine compatibility evidence only and must never be reported as Safari/iPad PASS.

## 3. Navigation/catalogue matrix

| ID | Scenario | Browser coverage | Assertion |
|---|---|---|---|
| N01 | Responsive login | B01, B03, B04, B07/B08 | Form usable; password eye toggles type/ARIA; no clipped controls/horizontal document overflow |
| N02 | Maths entry | B01, B03, B04 | Maths opens correct view screen |
| N03 | English entry | B01, B03, B04 | English opens correct view screen |
| N04 | Current/Previous grouping | B01, B03, B07 | Correct labels/metadata from Worker-authoritative home payload; no mirrored cross-subject history |
| N05 | Multiple simultaneous Current views | API inherited/static + browser where fixture is available | All active same-subject views remain Current; presentation only, no entitlement creation |
| N06 | Full canonical lesson list within a visible Year/Level | B01, B03, B04 | Expected canonical list length; locked and available lessons coexist without truncation |
| N07 | Long-list scroll to final lesson then back | B01, B03, B04, B08 | Final lesson reachable; no frozen/stuck list; back returns to lesson list/view chain |
| N08 | Search in long lesson list | B01, B03 | Matching lesson visible; clearing restores full list |
| N09 | Locked preview open | B01, B03, B07 | Safe metadata visible; resources remain locked; no gated-reference/raw URL leakage |
| N10 | Back chain | B01, B03, B04 | Lesson → Lessons → Year/Level → Subjects works repeatedly without stale content |
| N11 | Retained historical access | B01, B03 | Previous historical view remains discoverable and opens only earned/manual/full-library access |
| N12 | Full Library access source | API/static inherited + browser | Opens authorised content independently of D1 Student+Lesson rows; no fabricated entitlement |
| N13 | Manual individual/special access source | API/static inherited + browser | Independent discovery/gating preserved |

## 4. Resource matrix

Resource tests must discover the exact `resourceKey`, view and approved URL from the authenticated deployed payload. No guessed R2 key, ScreenPal URL, lesson ID/resource path, or special-resource identifier may be introduced merely to make a test runnable.

| ID | Resource | Context | Assertion |
|---|---|---|---|
| R01 | Ordinary Lesson Video | Ordinary Maths/English | Authenticated video endpoint returns an explicit approved HTTPS ScreenPal embed; no `quiz_id`; iframe loads in Lesson Video slot |
| R02 | 11+ ScreenPal interactive quiz | Authorised 11+ view | Explicit ScreenPal embed contains authorised interactive-quiz form; it replaces Lesson Video; separate Quiz section stays hidden/absent |
| R03 | ScreenPal playback signal | R01 and R02 | Player frame loads and playback control/media progress is exercised where browser automation permits; inability to establish actual playback is recorded NOT CONFIRMED, not PASS |
| R04 | ScreenPal fullscreen | R01 and R02 | Fullscreen control/API is exercised where browser/runtime permits; inability to establish actual fullscreen is recorded NOT CONFIRMED, not PASS |
| R05 | PreLesson download | Dynamically discovered unlocked lesson | UI request succeeds with PDF/octet-stream response from Worker route; downloaded bytes are non-empty; browser-facing URL does not reveal raw R2 |
| R06 | Homework download | Dynamically discovered unlocked lesson | Same as R05 |
| R07 | Relevant Other Resource | Dynamically discovered authorised 11+/ordinary resource | Exact authenticated Worker resource request succeeds; bytes non-empty; no raw R2 leakage |
| R08 | Protected Answer Pack/Key prompt | Dynamically discovered protected homework pair | Prompt appears every open; password input starts hidden; eye toggles hidden/visible and ARIA |
| R09 | Protected Answer Pack/Key valid open | R08 | Authorisation returns short-lived viewer path/token only; controlled PDF viewer renders pages; no download/print controls; no raw R2 in payload/DOM |
| R10 | Protected answer re-open | R08 | Closing then opening again returns to password prompt; prior open is not remembered |
| R11 | Protected viewer single-use/lease | API + browser | Reuse/invalidation behaves per accepted capability model |
| R12 | Protected viewer invalid after session revocation | Controlled test session only | Existing viewer ceases to work after session invalidation |
| R13 | Protected viewer invalid after Answer Pack password change | Controlled TestY KV backup/change/restore only | Previously issued viewer ceases to work; exact original profile restored |
| R14 | Empty/missing sections | Representative lessons | Portal hides absent sections and does not invent resources |

## 5. Session/security matrix

| ID | Scenario | Method | Required result |
|---|---|---|---|
| S01 | Opaque cookie/session | B01 | Login creates secure server-side session; raw password not reused on navigation calls |
| S02 | Latest-login-wins — two Chrome contexts | B01 + B03 | Newer successful login invalidates older context; newest remains valid |
| S03 | Cross-browser latest-login-wins | Chrome + Firefox | Newer successful login invalidates older browser session; newest remains valid |
| S04 | Reverse cross-browser latest-login-wins | Firefox + Chrome | Same invariant in reverse order |
| S05 | Two-hour inactivity while navigating | Controlled D1 aging of only the test session | Aged session receives `SESSION_EXPIRED`/401 and UI returns to login on next authoritative navigation call |
| S06 | Video activity refresh | B01 | ScreenPal play/activity message produces authenticated session-activity request and refreshes server activity while session is valid |
| S07 | Expired session while video is open | Controlled D1 aging of only the test session | Video activity cannot resurrect expired session; next authoritative route rejects it without damaging a newer session |
| S08 | Logout | B01/B03 | Logged-out session is rejected on subsequent session check |
| S09 | Login-password reset effect | Controlled TestY KV backup/change/restore only | Old active session is invalidated as required; old credential rejected after reset; new credential works; exact original profile restored |
| S10 | Answer-password change effect | Controlled TestY KV backup/change/restore only | Protected-view capability becomes invalid; exact profile restored |
| S11 | Session cleanup | All automated runs | Only sessions created during Phase 16 run are revoked/deleted; final active controlled test sessions = 0 |

## 6. Performance/realistic-data matrix

The accepted Phase 11 architecture is not redesigned in Phase 16. `/home` and Year/Level navigation remain manifest-driven; full LESSONS_KV data is fetched only for the target lesson/resource as already accepted.

| ID | Path | Data shape | Evidence |
|---|---|---|---|
| P01 | Login → home | Real deployed catalogue/navigation manifest | Browser/API timing captured |
| P02 | Subject → Year/Level | Realistic Current/Previous history | Browser/API timing captured |
| P03 | Long Year/Level lesson list | Full canonical list for selected visible Year/Level | API + render time and DOM row count captured |
| P04 | Long-list scroll/search | Full list | Interaction timing captured; no browser timeout/stall |
| P05 | Open ordinary lesson | Exact target lesson KV only | Lesson-detail response/render timing captured |
| P06 | Open 11+ lesson/VR | Authorised 11+ presentation | Lesson-detail response/render timing captured |
| P07 | Open/download resource | Exact resource only | Worker response timing captured |
| P08 | Protected answer render | Actual protected PDF | Authorise/fetch/render completion captured |

No new KV fan-out, catalogue rewrite, cache architecture, or speculative performance redesign is permitted in Phase 16.

## 7. Owner/device acceptance checklist

Owner acceptance must identify the actual device/browser exercised. It cannot be inferred from automated WebKit/viewport emulation.

For each owner-tested device/browser, record: device model/OS, browser and version if visible, login eye control, Maths + English entry, Current/Previous, a long lesson list, locked preview, ordinary video play/fullscreen, authorised 11+ video/interactive quiz where the owner account/test context permits, one PreLesson/Homework download, protected-answer prompt/view/close/re-open, back navigation, and latest-login-wins against another already logged-in device/browser.

Physical Android Chrome, macOS Safari and iPad Safari remain **NOT CONFIRMED** until actually exercised.

## 8. Closure rule

Phase 16 may be marked **CLOSED/PASS** only after:

1. all automated/static/API/D1/browser gates required by this matrix have passed;
2. every temporary mutation has been exactly cleaned and the Phase 15 baseline is restored;
3. browser/device results are labelled truthfully (an unavailable platform is NOT CONFIRMED, never PASS);
4. owner acceptance has been recorded for the platforms actually exercised;
5. production/general student login remains disabled and no DNS/CNAME/production route/live portal/canonical-catalogue/legacy-KV cutover action has occurred.

Phase 17 must not begin from this branch until Phase 16 is explicitly closed.