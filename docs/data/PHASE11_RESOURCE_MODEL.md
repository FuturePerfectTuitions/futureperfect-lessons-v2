# Phase 11 — protected extra-resource model

Status: **staging implementation contract — not deployed**

Phase 11 extends the completed Phase 7/8/9 lesson model without replacing it. Core Homework, ordinary protected Answer Packs, ScreenPal quiz gating and English VR continue to use the completed lower-layer architecture. This extension exists only for resource types discovered during real production-data reconciliation that the earlier proof model did not need to represent.

## Why this extension is required

The production lesson library contains legitimate resources beyond the original Phase 7 proof contract:

- core PreLesson Sheets that have protected PreLesson Answer Packs;
- additional 11+ PreLesson resources and protected answers;
- additional 11+ Homework resources and protected answers;
- Cumulative Homework and protected Cumulative Answer Packs;
- genuine additional protected answer resources that must be retained rather than deleted or forced into false one-to-one pairs.

All student-facing Answer Packs remain PDFs and remain protected by the student's existing Phase 8 Answer Pack password.

## Canonical lesson record

The existing `core`, `video`, `homeworks` and `vr` fields remain authoritative. Phase 11 adds an optional `phase11Resources` object:

```json
{
  "phase11Resources": {
    "core": {
      "preLessonPairs": [
        {
          "sheet": {
            "displayName": "PreLesson Sheet",
            "r2Key": "..."
          },
          "answerPack": {
            "displayName": "PreLesson Answer Pack",
            "r2Key": "..."
          }
        }
      ],
      "cumulativeHomeworks": [],
      "supplementaryAnswers": []
    },
    "elevenPlus": {
      "preLessonPairs": [],
      "homeworks": [],
      "cumulativeHomeworks": [],
      "supplementaryAnswers": []
    },
    "vr": {
      "supplementaryAnswers": []
    }
  }
}
```

A pair may legitimately contain only its sheet/primary side or only its answer side when that is what the reviewed source material contains. Phase 11 never fabricates the missing counterpart.

## Presentation rules

- `phase11Resources.core.*` follows the ordinary lesson visibility/lock state and can be visible in every view that legitimately exposes that canonical lesson.
- `phase11Resources.elevenPlus.*` is emitted only when the current student-facing presentation is `11plus`.
- `phase11Resources.vr.supplementaryAnswers` is emitted only when the completed Phase 9 Worker has already emitted the safe VR model for that lesson, so the existing VR entitlement check remains authoritative.
- Cumulative resources originating in shared Level 1/2/3 11+ source tracks are serialized under `elevenPlus.cumulativeHomeworks`.
- Cumulative resources genuinely belonging to normal Year 6 Extra lessons may be serialized under `core.cumulativeHomeworks`.

## Protected-answer reuse

`worker/src/index-phase11-resources.js` reuses Phase 8 rather than implementing a second password/viewer system.

Phase 11 reserves sparse protected-answer index ranges above the completed Phase 9 VR bridge ranges:

- 3001-3999: core PreLesson answers;
- 4001-4999: 11+ PreLesson answers;
- 5001-5999: 11+ Homework answers;
- 6001-6999: core Cumulative answers;
- 7001-7999: 11+ Cumulative answers;
- 8001-8999: core supplementary protected answers;
- 9001-9999: 11+ supplementary protected answers;
- 10001-10999: VR supplementary protected answers.

The Phase 11 adapter performs its own presentation/VR entitlement gate first, then bridges the approved resource into the existing Phase 8 `homeworks[index].answerPack` resolver for password authorisation, short-lived token creation, controlled PDF.js viewing, watermarking, single-use content opening, lease validation and password-change/session invalidation.

This means the Phase 8 security behaviour remains one system rather than being duplicated.

## Download resources

Non-answer Phase 11 resources receive opaque Worker resource keys and are downloaded only through Worker-authorised endpoints. Raw R2 keys are never returned to the student UI.

The extension resource-key kinds are:

- `p11corepre` — core PreLesson Sheet paired in the Phase 11 extension;
- `p11corecum` — core Cumulative Homework;
- `p11elevenpre` — 11+ PreLesson Sheet;
- `p11elevenhw` — 11+ Homework;
- `p11elevencum` — 11+ Cumulative Homework.

The 11+ kinds are rejected outside an 11+ presentation.

## Deployment boundary

The composition is:

`index-phase11-resources.js -> index-phase11.js -> index-phase10-history.js -> Phase 10 -> Phase 9 -> Phase 8 -> Phase 7 -> base`

The normal `worker/wrangler.toml` still points at `src/index-phase10-history.js`. Therefore the Phase 11 resource layer is source-only until the production catalogue, R2 and verification gates are complete.
