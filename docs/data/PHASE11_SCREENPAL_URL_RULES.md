# Phase 11 — ScreenPal URL rules

Status: **authoritative Phase 11 staging rule, user-confirmed 23 August 2026**

The following URL shapes were supplied directly by the FPT owner and may therefore be materialised from an existing trusted ScreenPal short code. This is no longer treated as guessing.

## Main lesson / VR video

For ScreenPal video short code `{VIDEO_ID}`:

- Content URL: `https://screenpal.com/content/video/{VIDEO_ID}`
- Watch URL: `https://go.screenpal.com/watch/{VIDEO_ID}`
- Player/embed iframe URL: `https://go.screenpal.com/player/{VIDEO_ID}?ff=1&ahc=1&dcc=1&tl=1&bg=transparent`

V2 catalogue records should store the explicit URL(s). The Worker must consume an explicit stored URL rather than constructing one at request time.

## ScreenPal quiz

For quiz short code `{QUIZ_ID}`:

- Direct quiz URL: `https://screenpal.com/content/quizzes/{QUIZ_ID}`

A website embed is a player URL containing both a **player/video ID** and the **quiz ID**:

`https://go.screenpal.com/player/{PLAYER_ID}?quiz_id={QUIZ_ID}&width=100%25&height=100%25&ff=1&title=0&dcc=0&bg=transparent&embedded=1`

The quiz short code alone is sufficient to materialise the direct quiz URL.

The quiz short code alone is **not** sufficient to materialise the embed URL because the embed also requires `{PLAYER_ID}`. V2 must not infer that player ID unless its provenance is explicit. Where no confirmed player ID exists, the 11+ quiz can safely use the explicit direct quiz URL.

## Presentation gate

ScreenPal quiz access remains presentation-based:
- normal Maths/English views: no quiz model or URL;
- 11+ Maths/English views: quiz may be exposed when that lesson has an approved direct/embed URL.

This does not change VR entitlement rules.
