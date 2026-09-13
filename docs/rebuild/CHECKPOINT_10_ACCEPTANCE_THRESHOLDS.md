# Checkpoint 10 — Acceptance Thresholds

Status: **PASS candidate — final exact-SHA and official-branch verification required before closure**

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

Backend/rebuild candidate:

`1c7d84d97a75d2b24618c5babbe3deaa35f4a0f2`

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
- isolated staging R2 containing the representative real production resource objects
- same-origin browser facade using a Cloudflare service binding to the isolated Student Worker
- exact CP7 frontend build served by the isolated browser facade

The production catalogue/resource metadata was used only as the authoritative read-only seed source. Production student credentials were not copied into staging.

## Measurement methodology

Checkpoint 10 introduced a dedicated real-browser acceptance harness rather than treating CP9's single timing samples as an acceptance result.

For thresholds described as applying "normally", five real-browser samples were taken and both median and p80 were required to be below the target. The first Year 6 catalogue after a fresh staging Worker deployment/login was treated separately as the cold-catalogue sample and itself had to be below 800 ms.

Measurements are perceived UI timings: button/click to the target UI being rendered, not only backend response time.

Subject selection was verified separately as a synchronous local render with zero API calls.

## Performance results

### Subject selection

Observed local-render samples:

- 0.6 ms
- 0.6 ms
- 0.8 ms

Rounded median/p80: **1 ms / 1 ms**.

No API call occurred as a result of the subject click.

**PASS**

### Cold Year 6 catalogue

First Year 6 catalogue after the fresh staging deployment/login:

**799.24 ms**

Target: below 800 ms.

**PASS**

### Warm Year 6 catalogue

Five same-session click-to-render samples:

- 210.13 ms
- 209.51 ms
- 210.84 ms
- 209.58 ms
- 109.50 ms

Rounded median: **210 ms**

Rounded p80: **210 ms**

Maximum: **211 ms**

Target: normally below 300 ms.

**PASS**

### Lesson detail

Five canonical lesson click-to-render samples:

- 820.08 ms
- 205.67 ms
- 206.29 ms
- 205.51 ms
- 205.55 ms

Rounded median: **206 ms**

Rounded p80: **206 ms**

The first freshly-read detail was a transient 820 ms sample; the repeated normal distribution was approximately 206 ms. The approved threshold is "below 800 ms under normal conditions", not a separate cold-start threshold.

**PASS — no exception required**

### Login/bootstrap

Five fresh browser-context login-click-to-Welcome samples:

- 825.30 ms
- 215.46 ms
- 220.20 ms
- 321.41 ms
- 321.09 ms

Rounded median: **321 ms**

Rounded p80: **321 ms**

Maximum: **825 ms**

Target: below 1.5 seconds under normal conditions.

**PASS**

### Bounded metadata/API failure

The original problematic English Year 5 catalogue path was intentionally held for 12 seconds while the accepted frontend retained its default 8-second network deadline.

Observed click-to-bounded-error/Retry state:

**8329 ms**

The loading spinner was no longer present after failure and a `Try again` action was visible.

Target: bounded failure, typically 5–10 seconds; zero infinite spinner.

**PASS**

## Security and delivery acceptance

The same real-browser gate also proved:

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

After acceptance timing was complete, the CP9 production-shaped backend UAT was rerun against the same staged data and passed again, including:

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

L3 cumulative Homework remains a content-state matter only. Its current absence is not encoded as a prohibition; future L3 cumulative Homework will flow through the existing cumulative-resource path when added.

## First-run harness correction

The first CP10 workflow run stopped at the cold-catalogue assertion because the harness rounded the measured timing before comparing it to the strict 800 ms threshold. A sub-800 raw value could therefore round to `800` and fail incorrectly.

Only the acceptance harness was corrected: threshold comparisons now use raw timing values and rounding is presentation-only. No Student Worker, frontend or production code was changed to obtain the passing result.

## Evidence

Passing feature-branch workflow run:

`34784441339`

Candidate SHA:

`1c7d84d97a75d2b24618c5babbe3deaa35f4a0f2`

Evidence artifact:

- name: `checkpoint10-acceptance-thresholds-evidence`
- artifact ID: `10325504738`
- digest: `sha256:35bfb7123848abcacaa5dd1fc65f55c5d4c9baef92712ff73cf6ec8098e0a97a`
- retention: 30 days

The evidence includes the acceptance summary, full gate summary, production anchor, CP9 functional summary and production-shaped seed summary.

## Production safety proof

Production remained unchanged throughout CP10 measurement:

- production deployment: `ce193be0-d018-403f-a417-999e9e6eea41`
- production version: `aed13a31-21fa-49c3-8830-c37fd8645c31`
- `productionChanged: false`

No production Student Worker route was repointed, no production pupil access was mutated, no production frontend was deployed, and no real communications were sent.

## Gate result

**Checkpoint 10 acceptance criteria: PASS candidate.**

No acceptance exception is being requested.

Checkpoint 10 is not considered officially closed until this documentation commit itself passes the exact-SHA Checkpoint 10 workflow and the same commit is fast-forwarded to the official rebuild branch followed by a successful official-branch run.

Checkpoint 11 has not started.
