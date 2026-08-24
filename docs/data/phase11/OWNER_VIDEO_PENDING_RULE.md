# Phase 11 — owner-confirmed pending video rule

The FPT owner confirmed on 24 August 2026 that the lessons without an existing ScreenPal main video are still in the process of being recorded.

For Phase 11 this is an intentional content state, not a catalogue blocker:

- the canonical lesson remains active;
- its R2 lesson resources remain available according to entitlement;
- `core.video` remains `null` until an explicit approved ScreenPal URL is supplied;
- `contentStatus.mainVideo` is `in_production` and `ownerConfirmedPending` is true;
- the Worker must not derive or guess a ScreenPal URL;
- adding the eventual explicit video metadata does not change the canonical Lesson ID, R2 resource paths or existing student entitlements.

The final Phase 11 catalogue contains 123 lessons with explicit approved main-video URLs and 246 owner-confirmed pending main videos.
