# FPT Portal V2 — Trial provisioning root-cause hardening GCH
## 22 September 2026

This is a **pause/resume checkpoint**, not a closeout. No further Portal mutation should be made from this handover until the restart sequence below has been followed.

## Owner requirement — binding
Sej explicitly rejected one-off/patch fixes. The next continuation must solve the Trial system structurally so **every newly created Trial account works on first use**, while preserving all previously approved Portal behaviour, including the friendly exhausted-Trial upsell message.

Do **not** treat `TrialEva` as the product requirement. Eva is evidence of a systemic provisioning defect only.

## Highest authority
Read the v4.2 authority pack **in full before changing anything**:
`FPT_Portal_V2_AUTHORITATIVE_FULL_v4.2_2026-09-21_VALIDATED.zip`
SHA-256: `e2c252c60c1f6ae714d5225259856b7f65aecc753e4f3384ba5e5221e981f1bb`

The v4.2 pack itself requires exact deployed-artifact provenance and capability preservation before executable mutations. Those controls are particularly important here because an earlier Trial fix accidentally replaced the friendly Trial-ended frontend behaviour.

## Current production facts at pause
- `FuturePerfectTuitions/futureperfect-lessons-v2` main: `b2ba6ddd772481ee48125d097a8cf0a3349f8c45`.
- Browser Worker: `fpt-portal-v2-rebuild-browser-prod` version `9190feb9-406b-4380-99ae-5b54ac1b29d9`.
- Student Worker: `fpt-portal-v2-rebuild-student-prod` version `51d725cc-d21e-4aad-9c64-24149c640637`.
- Admin/compat Worker: `fpt-portal-v2-worker` version `6ec87a49-a84c-4690-8c7c-3b2e3b237b52`.
- Public route remains `lessons.futureperfect.education/* -> fpt-portal-v2-rebuild-browser-prod`; Browser service binding `STAGING_API -> fpt-portal-v2-rebuild-student-prod`.
- Current accepted Browser frontend deployed source was built from `FuturePerfectTuitions/futureperfect-lessons-test@d7a416c2e13af7bab092efdb7694bde03ff7e245`, based on `63f37895727e41ada427c9644b41b5a026ed196b`.
- `futureperfect-lessons-test` **main is not that deployed source**; its main is still `96bfdc4dc3e72b0f354a205bc5a79f6d51c290f7`. This source-of-truth divergence is part of the root-cause risk.
- Friendly exhausted-Trial Browser UX deployment: workflow run `35693613024` PASS. It preserved TrialEva's consumed one-login state.

## Current observed product state
- TrialEva's selected access now works after the prepared-access record was explicitly republished; this proves the serving layer can represent the intended Trial views.
- The Admin console shows selected Trial views correctly.
- The original systemic defect was that a Trial could be created successfully in Admin while its Student-serving prepared access remained empty, producing `0 years / levels`.
- The friendly Trial-ended upsell message was restored after being overwritten by an earlier Browser deployment.

## Root-cause direction — do not shortcut
The authoritative serving model says the Student Portal is served from prepared access (`READ_MODELS_KV`) while Trial configuration/credentials live in `STUDENTS_KV`. Therefore a successful Trial create/re-arm must not return success until the selected Trial views have been compiled, published, and read-back verified in the Student-serving model.

The durable target is one coherent Trial provisioning lifecycle, not special handling for Eva:
1. validate Trial ID/views/password policy;
2. write canonical Trial profile;
3. establish/reset one-login consumption state as required;
4. compile selected Trial views against the current live catalogue;
5. atomically publish/verify prepared access to the serving store;
6. only then return Admin success;
7. first successful login atomically consumes the allowance;
8. subsequent login returns `TRIAL_ACCESS_ENDED`;
9. Browser maps that code to the approved friendly upsell message;
10. disable/delete/re-arm/reset each preserve their documented independent semantics.

Do not retain two competing access-authority paths long-term (prepared model plus ad-hoc request-time overlays) without an explicit architecture decision and regression proof.

## Mandatory restart sequence
1. Read every file in the v4.2 authority ZIP, respecting `07_CURRENT_STATE.json` authority order.
2. Freshly observe Browser/Student/Admin versions, public route, service bindings, KV/D1 identities and current source provenance.
3. Reconcile all post-v4.2 live changes into a single current capability manifest before coding: Trial provisioning, Trial delete, Create Student Login, Lesson Release first, PreLesson VR, protected Answer Packs, quiz withdrawal, parent email, Replace Resource, Trial-ended upsell.
4. Decide and document the single Trial access authority/compile path.
5. Build a table-driven Trial lifecycle regression suite that covers **all selectable Trial views**, not one user.
6. Add a live disposable Trial smoke test that creates a fresh Trial, verifies selected views/resources, verifies one-login consumption, verifies `TRIAL_ACCESS_ENDED` + friendly Browser upsell, then deletes the disposable account.
7. Make the production deployment gate fail if any preserved capability disappears.
8. Only after the complete suite passes, deploy the coherent root fix through a provenance-pinned workflow.
9. Re-run the disposable Trial test against production.
10. Update the master authority to a new version only after production truth is verified.

## Stop conditions
STOP and do not mutate production if any of these is true:
- exact current Browser/Student/Admin deployed provenance is not pinned;
- current live capabilities cannot be enumerated and compared pre/post;
- Trial create cannot be tested end-to-end with a disposable account;
- the friendly Trial-ended upsell source is not included in the deployment candidate;
- the candidate would deploy an older whole Worker/frontend bundle to fix one feature;
- a test proposes manually repairing an individual Trial as acceptance evidence;
- public Student Quiz withdrawal, PreLesson VR, protected Answer Packs, or existing Admin tools would regress.

## Explicit non-goal at this checkpoint
Do not continue engineering from this chat checkpoint. This GCH exists so Sej can switch to a priority task and return later without losing state.
