# Phase 7 — Renderer Fixtures

Status: development-only test fixtures for the Phase 7 complete lesson-page renderer checkpoint.

These records are intentionally separate from production curriculum data. They exist only to prove that the renderer handles materially different ordinary lesson-package shapes.

## 1. Minimal lesson

Lessons KV key:

`lesson:DEV-P7-MIN`

```json
{
  "schemaVersion": 1,
  "lessonId": "DEV-P7-MIN",
  "order": 9001,
  "title": "Phase 7 Minimal Lesson",
  "description": "Development-only Phase 7 fixture. This lesson intentionally has no PreLesson Sheets, no video, no Homework and no Other Resources so the reusable renderer can prove that empty sections disappear entirely.",
  "subject": "maths",
  "active": true,
  "testOnly": true,
  "displayIds": {
    "maths-year5": "Y5T3M98",
    "maths-level2": "L2T3M98"
  },
  "core": {
    "preLessonSheets": [],
    "video": null,
    "homeworks": [],
    "otherResources": []
  },
  "vr": null
}
```

## 2. Multiple-resource lesson

Lessons KV key:

`lesson:DEV-P7-MANY`

```json
{
  "schemaVersion": 1,
  "lessonId": "DEV-P7-MANY",
  "order": 9002,
  "title": "Phase 7 Multiple Resources",
  "description": "Development-only Phase 7 fixture. It deliberately contains multiple PreLesson Sheets, one ScreenPal video, multiple Homework and Answer Pack pairs, and multiple Other Resources so one data-driven renderer can prove all ordinary lesson-pack combinations without page-specific code.",
  "subject": "maths",
  "active": true,
  "testOnly": true,
  "displayIds": {
    "maths-year5": "Y5T3M99",
    "maths-level2": "L2T3M99"
  },
  "core": {
    "preLessonSheets": [
      {
        "displayName": "PreLesson Sheet A",
        "r2Key": "maths/Y5/Autumn/Y5M1/PreLesson/PreLesson Sheet Y5M1 Number and Place Value I.pdf"
      },
      {
        "displayName": "PreLesson Sheet B",
        "r2Key": "maths/Y5/Autumn/Y5M1/PreLesson/PreLesson Sheet Y5M1 Number and Place Value I.pdf"
      }
    ],
    "video": {
      "screenpal": "cOV0omn3XVh"
    },
    "homeworks": [
      {
        "homework": {
          "displayName": "Homework A",
          "r2Key": "maths/Y5/Autumn/Y5M1/Homework/Homework L2T1M01 Number and Place Value I.pdf"
        },
        "answerPack": {
          "displayName": "Answer Pack A",
          "r2Key": "maths/Y5/Autumn/Y5M1/Answers/Answer Pack Homework L2T1M01 Number and Place Value I.pdf"
        }
      },
      {
        "homework": {
          "displayName": "Homework B",
          "r2Key": "maths/Y5/Autumn/Y5M1/Homework/Homework L2T1M01 Number and Place Value I.pdf"
        },
        "answerPack": {
          "displayName": "Answer Pack B",
          "r2Key": "maths/Y5/Autumn/Y5M1/Answers/Answer Pack Homework L2T1M01 Number and Place Value I.pdf"
        }
      }
    ],
    "otherResources": [
      {
        "displayName": "Other Resource A",
        "r2Key": "maths/Y5/Autumn/Y5M1/PreLesson/PreLesson Sheet Y5M1 Number and Place Value I.pdf"
      },
      {
        "displayName": "Other Resource B",
        "r2Key": "maths/Y5/Autumn/Y5M1/Homework/Homework L2T1M01 Number and Place Value I.pdf"
      }
    ]
  },
  "vr": null
}
```

## 3. Ordinary English renderer proof

Lessons KV key:

`lesson:DEV-P7-ENGLISH`

```json
{
  "schemaVersion": 1,
  "lessonId": "DEV-P7-ENGLISH",
  "order": 9001,
  "title": "Phase 7 English Renderer Proof",
  "description": "Development-only normal-English fixture. It proves that the same ordinary lesson-page renderer works for English without introducing English-specific page code. Verbal Reasoning is deliberately absent because that extension belongs to Phase 9.",
  "subject": "english",
  "active": true,
  "testOnly": true,
  "displayIds": {
    "english-year5": "Y5T3E98",
    "english-year5-11plus": "Y5T3E98"
  },
  "core": {
    "preLessonSheets": [],
    "video": null,
    "homeworks": [],
    "otherResources": []
  },
  "vr": null
}
```

Canonical Year 5 English curriculum fixture:

Key:

`curriculum:ENGLISH_Y5`

Value:

```json
{
  "lessonIds": ["DEV-P7-ENGLISH"]
}
```

This catalogue was created only because no production Year 5 English catalogue existed in the development Lessons KV at the Phase 7 checkpoint.

## 4. Year 5 Maths proof catalogue additions

The existing development fallback view `view:maths-year5` was extended during Phase 7 testing to:

```json
{
  "schemaVersion": 1,
  "viewId": "maths-year5",
  "subject": "maths",
  "label": "Year 5",
  "lessonIds": ["Y5M1", "DEV-P7-MIN", "DEV-P7-MANY"]
}
```

The Phase 7 fixtures are development-only additions.

## 5. D1 entitlements for Test0101

The current `lesson_entitlements` table constrains `source` to the literal value `excel`. Therefore Phase 7 direct fixture grants use `source='excel'` and mark `source_batch_code='DEV-P7'` to make their development purpose explicit.

```sql
INSERT INTO lesson_entitlements (
  portal_user_id_norm,
  lesson_id,
  core_access,
  vr_access,
  source,
  first_granted_at,
  last_confirmed_at,
  source_batch_code,
  source_lesson_date
)
VALUES (
  'test0101',
  'DEV-P7-MIN',
  1,
  0,
  'excel',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  'DEV-P7',
  NULL
);
```

Equivalent row created for `DEV-P7-MANY`.

No D1 entitlement was created for `DEV-P7-ENGLISH`; that lesson was intentionally used as a cross-subject locked preview for `test0101`.

## 6. Canonical Y5M1 display-ID correction

During Phase 7 browser testing, `lesson:Y5M1` was found to lack the view-specific student-facing ID mapping required by Master v2.3.

The record was corrected by adding:

```json
"displayIds": {
  "maths-year5": "Y5T1M01",
  "maths-level2": "L2T1M01"
}
```

The canonical/internal lesson ID remains `Y5M1` and remains the entitlement key.

## 7. Cross-subject upsell presentation rule

Cross-subject preview content remains locked at the Worker/access-control layer, but the UI does not reveal that restriction prematurely.

Expected flow:

`Subject → Year/Level → lesson list → lesson page`

- Year/Level card: normal navigable presentation; no lock/Preview badge.
- Lesson-list row: normal View action; no Locked label.
- Individual lesson page: first explicit Locked/Preview indication.
- Locked lesson page: show title, description, actual section structure and display names only; resources remain inaccessible.

## Cleanup

Before production catalogue population/cutover, these fixtures must either be removed or remain unmistakably segregated as development-only test data:

- `lesson:DEV-P7-MIN`
- `lesson:DEV-P7-MANY`
- `lesson:DEV-P7-ENGLISH`
- `DEV-P7-MIN` / `DEV-P7-MANY` entries in the Year 5 Maths proof catalogue
- `curriculum:ENGLISH_Y5` if it has not yet been replaced by the real production catalogue
- D1 direct entitlement rows for `test0101 + DEV-P7-MIN` and `test0101 + DEV-P7-MANY`.
