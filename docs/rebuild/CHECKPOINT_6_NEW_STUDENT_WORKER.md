# Checkpoint 6 — New Student Worker

Status: implementation complete on the rebuild branch; production remains untouched.

## Scope

Checkpoint 6 replaces the legacy student request wrapper chain with a clean runtime built on the prepared read models and the Checkpoint 5 authentication/capability core. This checkpoint does not deploy or route production traffic and does not start Checkpoint 7 frontend work.

## Runtime path

The new Student Worker implements a single bounded request path:

1. Login validates the existing four-character student credential against authoritative `STUDENTS_KV`, then creates the Checkpoint 5 signed 8-hour absolute-expiry cookie. No D1 session row is created.
2. Authenticated navigation verifies that cookie locally and derives the opaque HMAC access scope from the user identity.
3. Home, subject, Year/Level and lesson requests read only verified prepared `global`, `access:<opaque-scope>` and, for unlocked lessons only, `lesson:<lesson-id>` objects. Prepared account status/expiry is enforced without a per-request student-store lookup; a locked account receives no Home views and cannot enter subject, lesson or resource routes.
4. Locked preview lessons never load lesson-detail resources and therefore never discover storage keys, video targets or capability inputs.
5. Video is lazy. The prepared lesson detail stores only validated ScreenPal variants; the lesson response exposes an opaque resource identifier. View issues a short `video` capability, rechecks the current access-model version and redirects directly to the selected ScreenPal target.
6. Ordinary resources use a short `download` capability and direct browser navigation. R2 is read only at delivery time; no runtime `HEAD` fan-out is used.
7. Answer Packs require the password on every open. The password is read fresh from authoritative `STUDENTS_KV`; failed attempts are rate-limited using the existing `answer_password_rate_limits` D1 table; success issues a short `answer-view` capability. Ordinary navigation never queries D1.
8. Every response is produced once by the new runtime. There is no internal redispatch through legacy student HTTP endpoints and no response reparse/rewrite chain.

## Prepared video metadata

`compileLessonDetail` now prepares validated ScreenPal normal/11+ video variants separately from R2 resources. Only `https` ScreenPal hosts are accepted and embed targets must be `go.screenpal.com/player/...`. Maths L1/L2/L3 selects the explicit quiz embed when present and otherwise falls back to the normal lesson video. Other views use the normal lesson video. Video URLs are not exposed in catalogue or lesson responses.

## Security and compatibility controls

- Checkpoint 5 signed session/capability code is reused unchanged.
- The session cookie remains `HttpOnly`, `Secure`, `SameSite=Lax`, with an absolute eight-hour lifetime and multi-device coexistence.
- Login preserves the current production enablement policy: development allowlist in development; `STUDENT_LOGIN_ENABLED=true` outside development.
- Cross-origin POSTs require an allowed browser Origin and preflight/CORS is bounded to configured origins.
- Student IDs do not appear in read-model keys; the existing HMAC-derived opaque scope format is preserved. Future shared access compilation normalizes the legacy `user.status` field into the prepared account status so inactive accounts are represented correctly.
- Capabilities bind user, session, view, lesson, resource and current access-model version.
- A newly published access snapshot invalidates capabilities issued against the previous access version.
- Answer Pack current-password validation is live on every open. The rate store is checked before password validation and uses only an opaque hash derived from the signed session id.
- No student session/activity table lookup, activity write, live entitlement query, `LESSONS_KV` lesson reconstruction, R2 `HEAD`, email/import/admin mutation path, legacy Phase Worker or service-binding redispatch is present in the new runtime.

## Automated gate

`tests/rebuild-checkpoint6-new-student-worker.mjs` proves:

- allowed-origin login and rejected untrusted-origin login;
- signed cookie login and two simultaneous sessions for one user;
- unauthenticated rejection;
- Home -> Maths/English -> Year 6/L3 -> lesson -> resource entirely through the new runtime;
- zero D1 queries during ordinary navigation;
- no R2 read or existence probe during lesson detail;
- lazy normal video and L3 quiz capability/redirect behavior;
- ordinary download capability and direct R2 delivery;
- live Answer Pack password change behavior, password-required behavior, protected inline delivery and 10-failed-attempt/60-second rate limiting;
- PreLesson-only isolation;
- locked preview with no lesson-detail read;
- access-version capability revocation;
- prepared inactive-account denial with no extra live student-store lookup;
- no legacy Phase/session/entitlement/activity constructs or internal student-route redispatch.

The Checkpoint 6 CI workflow also reruns Checkpoints 2, 3, 4 and 5 as regression gates.

## Deployment boundary

No production Worker, route, Cloudflare binding, KV/D1/R2 production data, entitlement, user or deployment state is changed by Checkpoint 6. The existing isolated rebuild read-model KV binding remains available in the staging Wrangler environment, but Checkpoint 6 deliberately does not add live student/auth/material bindings or secrets and does not deploy the new Worker. Production-shaped backfill/UAT and private deployment are later gates; the approved cutover plan does not place the new Student Worker under an unused production route until Checkpoint 11.

## Gate

Checkpoint 6 passes only when the feature-branch CI and the official rebuild-branch CI both pass the CP6 gate plus CP2–CP5 regressions on the exact committed SHA.
