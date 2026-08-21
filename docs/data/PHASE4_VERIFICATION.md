# Phase 4 Verification — Secure Student Authentication

**Status:** COMPLETE  
**Verified:** 21 August 2026  
**Environment:** V2 development only

## Purpose

Phase 4 replaces the fixed development-student authentication pattern with a real username/password login exchange and an opaque server-side session, while normal production student login remains disabled.

## Implemented authentication/session model

- Username comparison is case-insensitive.
- Login password is exactly 4 characters and contains at least one uppercase letter, one lowercase letter and one digit.
- Password is submitted only to the login endpoint; it is not stored in browser sessionStorage/localStorage.
- Successful login issues an opaque `fpt_v2_session` cookie.
- Cookie is `HttpOnly`, `Secure`, `Path=/`, `SameSite=None` for the current GitHub Pages → Worker development topology.
- D1 stores only the SHA-256 hash of the session token.
- Session inactivity expiry is 2 hours and slides forward with authenticated activity.
- Logout revokes the D1 session row and clears the browser cookie.
- Exactly one active session is permitted per Portal User ID.
- Migration `worker/migrations/0003_single_active_student_session.sql` installs D1 trigger `trg_student_sessions_single_active`; every new session insert revokes older active sessions for the same Portal User ID before the replacement row is inserted. The latest successful login wins.
- Normal real-student login remains disabled; only `DEV_LOGIN_ALLOWLIST` users can authenticate while `ENVIRONMENT=development`.

## D1 session schema verified

Table: `student_sessions`

Verified fields include:

- `token_hash`
- `portal_user_id_norm`
- `created_at`
- `last_activity_at`
- `idle_expires_at`
- `revoked_at`

Observed token hash length: **64 hexadecimal characters**, consistent with SHA-256.

## Verification results

### Phase 2 regression

`GET /api/dev/phase2`

- `dataFoundationHealthy: true`
- dummy student found
- dummy lesson found
- dummy view found
- D1 entitlement still readable

**Result:** PASS

### Phase 3 regression

`GET /api/dev/phase3`

- `phase3Healthy: true`
- `Y5M1` returned
- PreLesson available
- Homework available
- Answer Pack available/password-protected
- ScreenPal reference returned

**Result:** PASS

### Login and username normalisation

Development user `TEST0101` authenticated successfully using the mixed/uppercase spelling while the stored/returned Portal User ID is normalised to `test0101`.

**Result:** PASS

### Real-browser HttpOnly session

The GitHub Pages Phase 4 proof page uses `credentials: include` and successfully performs:

`Login → browser receives HttpOnly cookie → GET /api/v1/student/session → GET /api/dev/phase4`

JavaScript never reads the opaque session token.

**Result:** PASS

### Sliding inactivity timeout

Observed example:

- last activity `07:52:56`
- idle expiry `09:52:56`

Refresh moved both timestamps forward while preserving the exact 2-hour interval.

**Result:** PASS

### Logout

Browser changed to signed-out state and the corresponding newest D1 session row received `revoked_at`.

**Result:** PASS

### Development allowlist

Attempted login as non-allowlisted `OTHER0101` was rejected while normal student login remained disabled.

**Result:** PASS

### Single-device enforcement

Test sequence:

1. Sign in as `TEST0101` in Chrome.
2. Sign in as `TEST0101` in a second browser.
3. Second browser remains authenticated.
4. Refreshing the original Chrome session returns no active authenticated session.

**Result:** PASS — latest login wins; older browser/device is invalidated.

### Withdrawn account

`user:test0101` was temporarily set to `status: withdrawn`.

- authentication remained valid
- account displayed `Locked`
- lesson/resource proof was not healthy/accessible
- D1 entitlements were not deleted

Student record was restored afterward.

**Result:** PASS

### Expired account

`user:test0101` was temporarily given a past `expires` date while status remained active.

- authentication remained valid
- account displayed `Locked`
- lesson/resource proof was blocked

Student record was restored afterward.

**Result:** PASS

### Forced session expiry

The active D1 session's `idle_expires_at` was temporarily set into the past. The next authenticated browser refresh lost the session and returned to signed-out state.

**Result:** PASS — inactivity expiry is enforced server-side, not merely displayed.

### Wrong password

A valid-format but incorrect password (`T2st`) was rejected with generic invalid-login messaging and no authenticated session.

**Result:** PASS

### Final clean-state regression

After restoring the test student to:

- `status: active`
- `expires: null`

A correct login returned:

- authenticated `Test (test0101)` state
- status `active`
- 2-hour idle expiry
- green Phase 4 healthy proof
- authenticated lesson access working

**Result:** PASS

## Phase 4 checkpoint

Phase 4 is complete in the isolated V2 development environment.

Verified lifecycle:

`credentials → opaque HttpOnly cookie → hashed D1 session → authenticated portal/resource access → sliding 2-hour inactivity → single-device replacement → logout/session expiry revocation`

Expired/withdrawn accounts can authenticate but operate in globally locked mode.

Normal production student login is still deliberately disabled and the existing live portal remains untouched.
