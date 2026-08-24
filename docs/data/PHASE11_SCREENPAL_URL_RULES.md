# Phase 11 — ScreenPal URL and lesson-video rules

Status: **authoritative Phase 11 rule, user-confirmed 24 August 2026**

## Student-facing lesson video rule

`Lesson Video` is one frontend concept, not two separate resources.

- Normal-stream students receive the ordinary ScreenPal lesson video.
- 11+ stream students receive the ScreenPal quiz/interactivity variant in that same `Lesson Video` slot.
- The frontend must never show a second `ScreenPal Quiz`, `Quiz`, `Knowledge Check`, or `Open Quiz` section for the lesson.
- If an 11+ lesson has no configured quiz/interactivity variant, V2 must not fall back to the normal-stream video.
- Internal catalogue/API fields may retain `quiz` terminology as implementation metadata, but student-facing presentation is always `Lesson Video`.

This is a presentation/selection rule only. It does not change VR entitlement rules, lesson entitlement rules, Answer Pack protection, or the canonical catalogue IDs.

## Main lesson / VR video URLs

For a stored ScreenPal video, V2 uses explicit approved URLs from the canonical record. The Phase 11 runtime Worker does not synthesize provider URLs from bare short codes.

Canonical ordinary-video record shape:

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

VR videos use the same explicit field names inside `vr.preLessonVideo` and `vr.homeworkVideo` (or the compatible `vr.homeworkSolutionVideo` field).

## ScreenPal interactive/quiz variant

The canonical catalogue stores the 11+ interactive ScreenPal variant under the lesson video's `quiz` metadata. Its explicit embed URL contains the ScreenPal `quiz_id` and is already validated as an approved ScreenPal player URL.

Canonical stored shape:

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

The stored `displayName` remains catalogue metadata only. The student-facing UI does not display `ScreenPal Quiz`; it displays `Lesson Video`.

All 79 configured Phase 11 interactive variants have explicit approved embed URLs. No URL guessing is required for this selection rule.

## Runtime selection

For a normal presentation, `worker/src/phase11-screenpal.js` resolves the ordinary explicit video embed URL.

For an 11+ presentation, the same lesson-video endpoint resolves the explicit quiz/interactivity embed URL. It does not fall back to the ordinary video when no interactive variant exists.

`worker/src/index-phase11-final.js` removes the separate quiz model from the student-facing lesson-detail payload and exposes at most one `video` model for the lesson. The existing `Lesson Video` frontend renderer therefore remains the single presentation surface for both variants.

The internal quiz route may remain for compatibility and security verification, but it is not a separate student-facing lesson resource.

## Security boundary

The Phase 11 helper accepts only HTTPS ScreenPal hosts and, for iframe use, only `https://go.screenpal.com/player/...` URLs. Bare IDs are provenance only and deliberately produce no runtime target.

The existing live portal is not targeted by this rule. Normal production V2 student login remains disabled during development. Phase 12 is not part of this change.