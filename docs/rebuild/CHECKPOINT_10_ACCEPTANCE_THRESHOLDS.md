# Checkpoint 10 — Acceptance Thresholds

Status: **PASS candidate — optimized exact-SHA run passed; final documentation-SHA and official-branch verification required before closure**

Date: 2026-09-13

## Gate authority

The approved Checkpoint 10 gate requires:

- Subject click: immediate/local where feasible.
- Warm Year/Level catalogue: perceived near-instant, target normally below 300 ms.
- Cold Year/Level catalogue: target below 800 ms under normal conditions.
- Lesson detail: target below 800 ms under normal conditions.
- Login/bootstrap: target below 1.5 seconds under normal UK conditions.
- Metadata/API calls: bounded failure, typically 5–10 seconds depending on operation.
- Before View: zero ScreenPal/video requests.
- Locked preview: zero resource capabilities.
- Ordinary PDF: no JavaScript Blob reconstruction.
- Answer Pack: password every open, no recurring heartbeat.
- Infinite spinner: zero permitted paths.

Gate: acceptance criteria are met, or any exception must be explicitly approved before cutover.

## Candidate tested

Optimized backend/rebuild candidate:

`b730326d8224bae9f6f4e6e21c575bf2ba01dd8e`

Feature branch:

`rebuild/checkpoint10-acceptance-thresholds-2026-09-13`

Accepted CP7 frontend source remained pinned to:

`a4513da67ee66f51212114620c8e401bd5e31a8c`

No production frontend branch or public route was changed.

## Production-shaped environment

Checkpoint 10 reused the isolated CP9 staging architecture:

- isolated Student Worker: `fpt-portal-v2-rebuild-student-staging`
- isolated read-model KV
- isolated Students KV with synthetic UAT identities/passwords
- isolated staging D1 for Answer-Pack rate state
- isolated staging R2 containing representative real production resource objects
- same-origin browser facade using a Cloudflare service binding to the isolated Student Worker
- exact CP7 frontend build served by the isolated browser facade

The production catalogue/resource metadata was used only as the authoritative read-only seed source. Production student credentials were not copied into staging.

## Measurement methodology

For thresholds described as applying "normally", five real-browser samples were taken and both median and p80 were required to be below the target. The first Year 6 catalogue after a fresh staging Worker deployment/login was treated separately as the cold-catalogue sample and itself had to be below 800 ms.

Measurements are perceived UI timings: button/click to the target UI being rendered, not only backend response time. Subject selection was verified separately as a synchronous local render with zero API calls.

## Run history and retained failures

The genuine failures are part of the checkpoint record and are not discarded or averaged away:

1. Run `34784196065` on `74a683867dae67ed6582a942b5ba5a211c8d7ee5` failed because the harness rounded the cold timing before performing the strict `<800 ms` comparison. That was a harness precision defect. The harness was corrected so comparisons use raw values and rounding is presentation-only.
2. Run `34784441339` on `1c7d84d97a75d2b24618c5babbe3deaa35f4a0f2` passed with raw-timing comparison.
3. Documentation SHA `f2f1751cf29439d55ba0c706353190ea419cbd7f` ran as `34784675382` and failed genuinely: cold Year/Level catalogue measured **812.54079 ms**, above the published **<800 ms** target. Production-anchor verification still passed.
4. The threshold was not weakened. The rebuilt Student Worker was optimized so authenticated Home resolves the access model while priming the stable global prepared read model. The warm-up is best-effort for Home and does not send the catalogue to the browser or change local subject selection.
5. Optimized candidate `b730326d8224bae9f6f4e6e21c575bf2ba01dd8e` ran as `34784925141` and passed the complete CP10 workflow.

## Optimized performance results — run 34784925141

### Subject selection

Raw local-render samples:

- 0.6000 ms
- 0.6000 ms
- 0.6000 ms

Rounded median/p80: **1 ms / 1 ms**. No API call occurred as a result of the subject click.

**PASS**

### Cold Year 6 catalogue

First Year 6 catalogue after the fresh staging deployment/login:

**207.0287 ms**

Target: below 800 ms.

**PASS**

### Warm Year 6 catalogue

Raw same-session click-to-render samples:

- 211.6339 ms
- 108.6344 ms
- 111.1076 ms
- 207.4866 ms
- 108.5335 ms

Rounded median: **111 ms**

Rounded p80: **207 ms**

Maximum: **212 ms**

Target: normally below 300 ms.

**PASS**

### Lesson detail

Raw canonical lesson click-to-render samples:

- 804.9502 ms
- 205.6992 ms
- 223.2689 ms
- 221.9535 ms
- 205.2849 ms

Rounded median: **222 ms**

Rounded p80: **223 ms**

Maximum: **805 ms**

The first freshly-read detail was a transient 804.95 ms sample; the five-sample normal criterion remained well below the approved 800 ms target. The approved criterion is "below 800 ms under normal conditions", not a separate single-sample cold detail threshold.

**PASS — no exception required**

### Login/bootstrap

Raw fresh-browser-context login-click-to-Welcome samples:

- 1323.6790 ms
- 219.6382 ms
- 221.0604 ms
- 211.4215 ms
- 207.5100 ms

Rounded median: **220 ms**

Rounded p80: **221 ms**

Maximum: **1324 ms**

Target: below 1.5 seconds under normal UK conditions.

**PASS**

### Bounded metadata/API failure

The intentionally delayed English Year 5 catalogue path exceeded the accepted frontend's default 8-second network deadline.

Observed click-to-bounded-error/Retry state:

**8335.0014 ms**

The loading spinner was no longer present after failure and a `Try again` action was visible.

Target: bounded failure, typically 5–10 seconds; zero infinite spinner.

**PASS**

## Security and delivery acceptance

The optimized real-browser gate also proved:

- zero ScreenPal requests before the first explicit `View` action;
- the lesson video iframe had no `src` before View;
- View initiated the expected ScreenPal request;
- locked preview exposed no ordinary resource link, Answer-Pack control, video player or capability-bearing resource request;
- ordinary resource delivery remained direct browser navigation and the accepted ordinary-resource app contains no `new Blob`, `URL.createObjectURL` or `.blob()` reconstruction path;
- Answer Pack displayed a password prompt on both consecutive opens and generated two separate authorisation POSTs;
- after the second authorised Answer Pack opened, a 31-second observation window produced no recurring API request/heartbeat;
- accepted Answer-Pack viewer source contains no heartbeat marker or recurring `setInterval` path;
- CP7's default metadata/API deadline remains 8000 ms;
- the forced long English Year 5 operation rendered a bounded retry state rather than an infinite spinner.

All above assertions passed.

## Functional regression

After acceptance timing, the CP9 production-shaped backend UAT was rerun against the same staged data and passed again, including:

- normal navigation;
- ordinary resource delivery;
- protected Answer Packs and rate limiting;
- SATs;
- L2 cumulative Homework;
- L3 video redirect;
- current/previous history;
- locked preview;
- guest/manual access;
- PreLesson-only access.

L3 cumulative Homework remains a content-state matter only. Its current absence is not encoded as a prohibition; future L3 cumulative Homework will flow through the existing generic `cumulative-homework` resource path when added.

## Evidence

Optimized passing feature-branch workflow run:

`34784925141`

Candidate SHA:

`b730326d8224bae9f6f4e6e21c575bf2ba01dd8e`

Evidence artifact:

- name: `checkpoint10-acceptance-thresholds-evidence`
- artifact ID: `10326148158`
- digest: `sha256:4e524e31a1991fc748f2c307983285f332aba7cb19bf9e8f9e223fd21ff0eedf`
- retention: 30 days

Retained earlier evidence includes the first harness failure, the pre-documentation PASS and the genuine 812.54 ms documentation-SHA cold failure. No failed evidence is being overwritten or omitted from the checkpoint history.

## Production safety proof

Production remained unchanged throughout the optimized CP10 measurement:

- production deployment: `ce193be0-d018-403f-a417-999e9e6eea41`
- production version: `aed13a31-21fa-49c3-8830-c37fd8645c31`
- `productionChanged: false`

No production Student Worker route was repointed, no production pupil access was mutated, no production frontend was deployed, and no real communications were sent.

## Gate result

**Checkpoint 10 acceptance criteria: PASS candidate on optimized SHA.**

No acceptance exception is being requested and no threshold was weakened.

Checkpoint 10 is not officially closed until this final documentation commit itself passes the exact-SHA Checkpoint 10 workflow, the official rebuild branch is confirmed still at the CP9 anchor and then fast-forwarded with `force=false`, and the same promoted SHA independently passes the Checkpoint 10 workflow from the official rebuild branch. Production and live frontend anchors must remain unchanged through those closure steps.

Checkpoint 11 has not started at the time of this documentation update.
