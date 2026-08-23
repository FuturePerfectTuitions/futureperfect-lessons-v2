# Phase 11 — ScreenPal URL rules

Status: **authoritative Phase 11 staging rule, user-confirmed 23 August 2026**

The following URL shapes were supplied directly by the FPT owner and may therefore be materialised from an existing trusted ScreenPal short code. This is no longer treated as guessing.

## Main lesson / VR video

For ScreenPal video short code `{VIDEO_ID}`:

- Content URL: `https://screenpal.com/content/video/{VIDEO_ID}`
- Watch URL: `https://go.screenpal.com/watch/{VIDEO_ID}`
- Player/embed iframe URL: `https://go.screenpal.com/player/{VIDEO_ID}?ff=1&ahc=1&dcc=1&tl=1&bg=transparent`

V2 catalogue records store the explicit URL(s). The short code may remain alongside them as provenance, but the Phase 11 runtime Worker consumes `embedUrl` and never constructs a provider URL from the short code.

Canonical record shape:

```json
{
  "core": {
    "video": {
      "screenpal": "cOj3bFnvPmr",
      "contentUrl": "https://screenpal.com/content/video/cOj3bFnvPmr",
      "watchUrl": "https://go.screenpal.com/watch/cOj3bFnvPmr",
      "embedUrl": "https://go.screenpal.com/player/cOj3bFnvPmr?ff=1&ahc=1&dcc=1&tl=1&bg=transparent"
    }
  }
}
```

Where a lesson has a distinct 11+ video, it may be stored under `video.elevenPlus` with the same explicit fields. The Phase 11 Worker selects that override only in an 11+ presentation.

VR videos use the same explicit field names inside `vr.preLessonVideo` and `vr.homeworkVideo` (or the compatible `vr.homeworkSolutionVideo` field).

## ScreenPal quiz

For quiz short code `{QUIZ_ID}`:

- Direct quiz URL: `https://screenpal.com/content/quizzes/{QUIZ_ID}`

A website embed is a player URL containing both a **player/video ID** and the **quiz ID**:

`https://go.screenpal.com/player/{PLAYER_ID}?quiz_id={QUIZ_ID}&width=100%25&height=100%25&ff=1&title=0&dcc=0&bg=transparent&embedded=1`

The quiz short code alone is sufficient to materialise the direct quiz URL.

For the legacy Phase 11 catalogue, `{PLAYER_ID}` is the lesson's legacy **standard video short code**. This is explicitly validated by the user-supplied example: player `cO1b1nnupar` + quiz `cOivb222Z`, which corresponds to the same catalogue lesson (`Y5M37 Properties of Shapes 3`).

Therefore, when a trusted legacy lesson has both a standard video short code and quiz short code, Phase 11 may materialise the quiz embed URL using those two stored values. It must still store the resulting explicit URL; the runtime Worker must not synthesize it from bare IDs.

Canonical quiz shape:

```json
{
  "core": {
    "video": {
      "screenpal": "cO1b1nnupar",
      "quiz": {
        "id": "cOivb222Z",
        "shareUrl": "https://screenpal.com/content/quizzes/cOivb222Z",
        "embedUrl": "https://go.screenpal.com/player/cO1b1nnupar?quiz_id=cOivb222Z&width=100%25&height=100%25&ff=1&title=0&dcc=0&bg=transparent&embedded=1",
        "displayName": "ScreenPal Quiz"
      }
    }
  }
}
```

A direct quiz URL is sufficient when an embed URL is unavailable. If both are stored, V2 prefers the embed URL.

## Phase 11 Worker boundary

`worker/src/index-phase11.js` sits above the completed Phase 10 history Worker. It intercepts only ScreenPal video/quiz resource opens, reuses the established Phase 10/9/8/7 access checks, then returns the explicit stored URL from the canonical lesson record.

The Phase 11 helper accepts only HTTPS ScreenPal hosts and, for iframe use, only `https://go.screenpal.com/player/...` URLs. Bare IDs are provenance only and deliberately produce no runtime target.

The repository's normal `worker/wrangler.toml` remains pointed at `src/index-phase10-history.js` until the Phase 11 catalogue and verification gates are complete. Adding the Phase 11 source therefore does not deploy or activate it.

## Presentation gate

ScreenPal quiz access remains presentation-based:
- normal Maths/English views: no quiz model or URL;
- 11+ Maths/English views: quiz may be exposed when that lesson has an approved direct/embed URL.

This does not change VR entitlement rules.
