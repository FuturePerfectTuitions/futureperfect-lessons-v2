# Checkpoint 5 — Authentication and Capability Core

Status: implementation/gate artifact for official Checkpoint 5 only.

## Scope

This checkpoint implements the shared authentication/capability primitives required by the approved Portal V2 performance rebuild architecture. It does not repoint production student reads and it does not start Checkpoint 6.

Implemented:
- cryptographically signed first-party authentication token suitable for an HttpOnly, Secure, SameSite=Lax host cookie;
- exactly 8-hour absolute session expiry with no sliding renewal;
- independent simultaneous sessions for the same user (approved multi-device semantics);
- stateless local HMAC verification with no per-request D1 session lookup;
- short-lived, independently issued capabilities for `video`, ordinary `download`, and `answer-view`;
- maximum capability lifetime of five minutes;
- exact capability binding to user, session, view, lesson, resource, capability type, and optional access-snapshot version;
- logout helper that clears only the current device cookie;
- Answer Pack authorization coordinator that performs a live current-password validation on every open, respects a live rate-limit adapter, and only then issues an `answer-view` capability.

## Security properties

The token payload is signed, not encrypted. It must contain identifiers only and never passwords, signing secrets, raw credentials, or other secret material.

Capability verification requires a complete expected binding. A verifier cannot intentionally omit user, session, view, lesson, resource, or capability type and still accept the token.

Answer Pack passwords are not cached by this core and are not embedded in the viewer capability. The caller must provide authoritative live adapters for current-password validation and attempt/rate controls. This preserves the existing control-plane responsibility while allowing the later student runtime to verify the resulting viewer capability locally.

The signing key is runtime configuration/secret material and is not stored in the repository.

## Gate

`tests/rebuild-checkpoint5-auth-capability-core.mjs` proves:
- signed session lifetime is exactly eight hours;
- modified/expired sessions are rejected;
- two sessions for the same user can coexist;
- video/download/answer-view capabilities are independently issued;
- capability lifetime cannot exceed five minutes;
- modified and expired capabilities are rejected;
- wrong-user, wrong-resource and wrong-view capabilities are rejected;
- wrong-session, wrong-lesson, wrong-type and wrong-access-version bindings are also rejected;
- Answer Pack current-password validation runs on every non-rate-limited open;
- a changed Answer Pack password immediately invalidates the old password at the next open;
- rate limiting blocks validation/capability issue when the live adapter says the attempt is blocked;
- Answer Pack passwords do not appear in issued capabilities;
- the Checkpoint 5 core contains no D1 session-query/activity machinery.

The Checkpoint 5 CI workflow is static and synthetic. It does not use production credentials, Cloudflare secrets, production data, or real pupil records.

## Integration boundary for Checkpoint 6

Checkpoint 6 may consume these primitives in the new Student Worker. Credential validation at login remains a control-plane action; after successful login, the new runtime can issue the signed 8-hour cookie. Ordinary authenticated reads verify that cookie locally. Resource authorisation can issue exact short-lived capabilities after checking the already-compiled access snapshot.

For Answer Packs, Checkpoint 6 must connect `authorizeAnswerPackOpen()` to the authoritative current-password validator and central attempt/rate-limit store before issuing the viewer capability.

No production Student Worker route, legacy Worker entrypoint, read-model pointer, KV/D1/R2 data, or deployment state is changed by this checkpoint.

## Rollback

Rollback is deletion/reversion of these additive Checkpoint 5 files. Checkpoint 4 remains the production shadow state and the legacy production runtime remains authoritative.
